import { readFile, writeFile, mkdir, access, unlink, cp, rmdir } from 'fs/promises'
import { join } from 'path'

export default class LuneDatabase {
    #indices = {}

    constructor(tables = [], options = {}) {
        this.options = options
        this.inMemory = options.inMemory || false
        this.memoryData = {}
        this.basePath = options.path || './data'
        this.tables = tables.map(t => this.#buildTableEntry(t))
    }

    #buildTableEntry(tableConfig) {
        return { ...tableConfig, path: join(this.basePath, `${tableConfig.name}.json`) }
    }

    #findTable(name) {
        return this.tables.find(t => t.name === name)
    }

    #requireTable(name) {
        const t = this.#findTable(name)
        if (!t) throw new Error(`Tabla "${name}" no encontrada`)
        return t
    }

    #project(record, fields) {
        if (!fields?.length) return record

        const res = {}
        for (const f of fields) {
            if (f in record) res[f] = record[f]
        }
        return res
    }

    async #readTable(table) {
        if (this.inMemory) return this.memoryData[table.name] || []
        const raw = await readFile(table.path, 'utf-8')
        return JSON.parse(raw)
    }

    async #writeTable(table, data) {
        if (this.inMemory) {
            this.memoryData[table.name] = data
        } else {
            await writeFile(table.path, JSON.stringify(data, null, 2), 'utf-8')
        }
        this.#rebuildIndex(table, data)
    }

    #stripInternal({ path: _p, ...config }) {
        return config
    }

    #assertWritable(table, op) {
        if (table.options?.readonly) throw new Error(`Tabla "${table.name}" readonly: ${op}`)
    }

    #applyTimestampCreate(table, record) {
        if (!table.options?.timestamps) return record
        const now = new Date().toISOString()
        return { ...record, createdAt: now, updatedAt: now }
    }

    #applyTimestampUpdate(table, record) {
        if (!table.options?.timestamps) return record
        return { ...record, updatedAt: new Date().toISOString() }
    }

    #validateSchema(table, record, isUpdate = false) {
        const schema = table.schema
        if (!schema) return record
        if (typeof schema.validate !== 'function') throw new Error('Schema inválido')
        if (isUpdate) return record
        const { valid, errors, value } = schema.validate(record)
        if (!valid) {
            const resumen = Object.entries(errors).map(([k, v]) => `${k}:${JSON.stringify(v)}`).join(',')
            throw new Error(`Error validación tabla "${table.name}": ${resumen}`)
        }
        return { ...record, ...value }
    }

    async #validateForeignKeys(table, newArray) {
        if (!table.foreignKeys?.length) return
        for (const fk of table.foreignKeys) {
            const foreignTable = this.#findTable(fk.tableName)
            if (!foreignTable) throw new Error(`Foreign table "${fk.tableName}" not found`)
            const foreignData = await this.#readTable(foreignTable)
            const validValues = new Set(foreignData.map(d => d[fk.foreignField]))
            for (const record of newArray) {
                const val = record[fk.localField]
                if (val == null && table.options?.foreignKeysRequired) {
                    throw new Error(`Foreign key "${fk.localField}" required in "${table.name}"`)
                }
                if (val != null && !validValues.has(val)) {
                    throw new Error(`Foreign key invalid "${fk.localField}"=${val} in "${table.name}"`)
                }
            }
        }
    }

    async #runHook(table, hookName, payload) {
        const hook = table.hooks?.[hookName]
        if (typeof hook === 'function') await hook(payload)
    }

    #rebuildIndex(table, data) {
        const fields = table.indices
        if (!fields?.length) return
        const idx = {}
        for (const f of fields) {
            idx[f] = {}
            for (const r of data) {
                const val = r[f]
                if (val === undefined) continue
                const key = String(val)
                if (!idx[f][key]) idx[f][key] = []
                idx[f][key].push(r)
            }
        }
        this.#indices[table.name] = idx
    }

    async init() {
        await mkdir(this.basePath, { recursive: true })
        for (const table of this.tables) {
            try {
                await access(table.path)
                const data = await this.#readTable(table)
                this.#rebuildIndex(table, data)
                if (this.inMemory) this.memoryData[table.name] = data
            } catch {
                await this.#writeTable(table, [])
            }
        }
    }

    async save() {
        if (!this.inMemory) return
        for (const table of this.tables) {
            const data = this.memoryData[table.name] || []
            await writeFile(table.path, JSON.stringify(data, null, 2), 'utf-8')
        }
    }

    async get(tableName, filter = () => true, fields = null) {
        const table = this.#requireTable(tableName)
        const data = await this.#readTable(table)
        const base = table.options?.softDelete ? data.filter(r => !r.deletedAt) : data

        return base
            .filter(filter)
            .map(r => this.#project(r, fields))
    }

    async find(tableName, filter, fields = null) {
        const results = await this.get(tableName, filter, fields)
        return results[0]
    }

    async exists(tableName, filter) {
        return (await this.find(tableName, filter)) !== undefined
    }

    async count(tableName, filter = () => true) {
        return (await this.get(tableName, filter)).length
    }

    async add(tableName, newRecords) {
        const table = this.#requireTable(tableName)
        this.#assertWritable(table, 'add')
        const existing = await this.#readTable(table)
        const array = Array.isArray(newRecords) ? newRecords : [newRecords]
        await this.#validateForeignKeys(table, array)
        let maxId = existing.length ? Math.max(...existing.map(d => d[table.id] || 0)) : 0
        const idsUsed = new Set(existing.map(d => d[table.id]))
        const processed = array.map(r => {
            r = this.#validateSchema(table, r, false)
            if (table.options?.idAutoIncrementable && r[table.id] == null) maxId++, r[table.id] = maxId
            if (table.options?.idUnique && r[table.id] != null) {
                if (idsUsed.has(r[table.id])) throw new Error(`ID ${r[table.id]} exists in "${tableName}"`)
                idsUsed.add(r[table.id])
            }
            return this.#applyTimestampCreate(table, r)
        })
        await this.#runHook(table, 'beforeAdd', { table: tableName, datos: processed })
        const updated = [...existing, ...processed]
        await this.#writeTable(table, updated)
        await this.#runHook(table, 'afterAdd', { table: tableName, datos: processed })
        return updated
    }

    async update(tableName, filter, newData) {
        const table = this.#requireTable(tableName)
        this.#assertWritable(table, 'update')
        const existing = await this.#readTable(table)
        const fksAffected = (table.foreignKeys || []).filter(fk => fk.localField in newData)
        if (fksAffected.length) await this.#validateForeignKeys({ ...table, foreignKeys: fksAffected }, [newData])
        newData = this.#validateSchema(table, newData, true)
        await this.#runHook(table, 'beforeUpdate', { table: tableName, filter, newData })
        let countUpdated = 0
        const updated = existing.map(r => {
            if (!filter(r)) return r
            countUpdated++
            let updatedRecord = { ...r, ...newData }
            if (table.options?.idAutoIncrementable || table.options?.idUnique) updatedRecord[table.id] = r[table.id]
            return this.#applyTimestampUpdate(table, updatedRecord)
        })
        if (countUpdated === 0) throw new Error(`No records match filter in "${tableName}"`)
        await this.#writeTable(table, updated)
        await this.#runHook(table, 'afterUpdate', { table: tableName, actualizados: countUpdated })
        return updated
    }

    async updateAll(tableName, newData) {
        const table = this.#requireTable(tableName)
        this.#assertWritable(table, 'updateAll')
        const existing = await this.#readTable(table)
        const updated = existing.map(r => {
            const validated = this.#validateSchema(table, newData, true)
            return this.#applyTimestampUpdate(table, { ...r, ...validated })
        })
        await this.#writeTable(table, updated)
        return updated
    }

    async delete(tableName, filter = () => true) {
        const table = this.#requireTable(tableName)
        this.#assertWritable(table, 'delete')
        const existing = await this.#readTable(table)
        const deletedRecords = existing.filter(filter)
        if (!deletedRecords.length) return existing
        if (table.options?.softDelete) {
            await this.#runHook(table, 'beforeDelete', { table: tableName, registros: deletedRecords })
            const now = new Date().toISOString()
            const updated = existing.map(r => filter(r) ? { ...r, deletedAt: now } : r)
            await this.#writeTable(table, updated)
            await this.#runHook(table, 'afterDelete', { table: tableName, registros: deletedRecords })
            return updated.filter(r => !r.deletedAt)
        }
        for (const other of this.tables) {
            if (other.name === tableName) continue
            const fks = (other.foreignKeys || []).filter(fk => fk.tableName === tableName)
            if (!fks.length) continue
            const otherData = await this.#readTable(other)
            for (const fk of fks) {
                const deletedSet = new Set(deletedRecords.map(r => r[fk.foreignField]))
                const hasRefs = otherData.some(r => deletedSet.has(r[fk.localField]))
                if (hasRefs) throw new Error(`Cannot delete: "${other.name}" references "${tableName}.${fk.foreignField}"`)
            }
        }
        await this.#runHook(table, 'beforeDelete', { table: tableName, registros: deletedRecords })
        const remaining = existing.filter(r => !filter(r))
        await this.#writeTable(table, remaining)
        await this.#runHook(table, 'afterDelete', { table: tableName, registros: deletedRecords })
        return remaining
    }

    async clear(tableName) {
        const table = this.#requireTable(tableName)
        this.#assertWritable(table, 'clear')
        await this.#writeTable(table, [])
        return []
    }

    async seed(tableName, data) {
        const table = this.#requireTable(tableName)
        const existing = await this.#readTable(table)
        if (existing.length > 0) return existing
        return this.add(tableName, data)
    }

    async join(tableName, foreignTableName, localField, foreignField = localField, alias = foreignTableName, fields = null) {
        this.#requireTable(tableName)
        const foreignTable = this.#requireTable(foreignTableName)
        const data = await this.get(tableName)
        const foreignData = await this.#readTable(foreignTable)
        const map = new Map(foreignData.map(r => [r[foreignField], r]))

        return data.map(r => {
            const joined = {
                ...r,
                [alias]: map.get(r[localField]) ?? null
            }
            return this.#project(joined, fields)
        })
    }

    async findByIndex(tableName, field, value) {
        this.#requireTable(tableName)
        const idx = this.#indices[tableName]?.[field]
        if (idx) return idx[String(value)] ?? []
        return this.get(tableName, r => r[field] === value)
    }

    async getDeleted(tableName) {
        const table = this.#requireTable(tableName)
        if (!table.options?.softDelete) throw new Error(`Table "${tableName}" has no softDelete`)
        const data = await this.#readTable(table)
        return data.filter(r => r.deletedAt)
    }

    async restore(tableName, filter) {
        const table = this.#requireTable(tableName)
        this.#assertWritable(table, 'restore')
        if (!table.options?.softDelete) throw new Error(`Table "${tableName}" has no softDelete`)
        const data = await this.#readTable(table)
        let restored = 0
        const updated = data.map(r => {
            if (!r.deletedAt || !filter(r)) return r
            restored++
            const { deletedAt: _d, ...rest } = r
            return rest
        })
        if (restored === 0) throw new Error(`No deleted records match in "${tableName}"`)
        await this.#writeTable(table, updated)
        return updated.filter(r => !r.deletedAt)
    }

    async backup(dest = './backups') {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
        const destFolder = join(dest, `backup-${timestamp}`)
        await mkdir(destFolder, { recursive: true })
        await cp(this.basePath, destFolder, { recursive: true })
        return destFolder
    }

    async drop({ confirmar = false } = {}) {
        if (!confirmar) throw new Error('drop() is destructive. Use {confirmar:true}')
        for (const t of [...this.tables]) {
            try { await unlink(t.path) } catch { }
        }
        this.tables = []
        this.#indices = {}
        try { await rmdir(this.basePath) } catch { }
    }

    async getTable(tableName) {
        return this.#stripInternal(this.#requireTable(tableName))
    }

    async createTable(tableConfig) {
        if (!tableConfig?.name) throw new Error('Must have name')
        if (this.#findTable(tableConfig.name)) throw new Error('Already exists')
        const table = this.#buildTableEntry(tableConfig)
        await this.#writeTable(table, [])
        this.tables.push(table)
        return this.#stripInternal(table)
    }

    async updateTable(tableName, config) {
        const idx = this.tables.findIndex(t => t.name === tableName)
        if (idx === -1) throw new Error('Table not found')
        this.tables[idx] = { ...this.tables[idx], ...config }
        return this.#stripInternal(this.tables[idx])
    }

    async deleteTable(tableName) {
        const idx = this.tables.findIndex(t => t.name === tableName)
        if (idx === -1) throw new Error('Table not found')
        const [t] = this.tables.splice(idx, 1)
        delete this.#indices[tableName]
        if (!this.inMemory) {
            try { await unlink(t.path) } catch { }
        }
        return this.#stripInternal(t)
    }
}