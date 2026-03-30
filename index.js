import { readFile, writeFile, mkdir, access, unlink, cp } from 'fs/promises';
import { join } from 'path';

// ─────────────────────────────────────────────────────────────────────────────
//  SCHEMA VALIDATORS
//
//  LuneDataBase acepta dos formatos de schema en tablaConfig.schema:
//
//  1. Schema nativo (objeto plano):
//     { campo: { type, required, default } }
//     type soportados: 'string' | 'number' | 'boolean' | 'array' | 'object'
//
//  2. Schema de LuneModels:
//     a) Schema completo → LuneModels.schema({ ... })
//        Tiene .validate(data) que recibe el objeto entero.
//     b) Definición de campos → { campo: LuneModels.string().required()... }
//        Cada campo tiene ._type y .validate(value).
//
//  La detección es automática. No hace falta configurar nada extra.
// ─────────────────────────────────────────────────────────────────────────────

const TYPE_VALIDATORS = {
    string:  v => typeof v === 'string',
    number:  v => typeof v === 'number',
    boolean: v => typeof v === 'boolean',
    array:   v => Array.isArray(v),
    object:  v => v !== null && typeof v === 'object' && !Array.isArray(v),
};

/** Devuelve true si el schema es un LuneModels.schema() completo */
function isLuneSchema(schema) {
    return schema !== null
        && typeof schema === 'object'
        && typeof schema.validate === 'function'
        && !schema._type;
}

/** Devuelve true si el campo es un validador suelto de LuneModels (string(), number()...) */
function isLuneValidator(field) {
    return field !== null
        && typeof field === 'object'
        && typeof field.validate === 'function'
        && typeof field._type === 'string';
}

// ─────────────────────────────────────────────────────────────────────────────
//  CLASS
// ─────────────────────────────────────────────────────────────────────────────

export default class LuneDataBase {

    /**
     * @param {Array}  tablas  - Array de configuraciones de tabla
     * @param {string} carpeta - Carpeta raíz donde se guardan los .json
     *
     * Opciones disponibles por tabla (tabla.options):
     *   idAutoIncrementable {boolean} - Genera id numérico automático
     *   idUnique            {boolean} - Lanza error si el id ya existe
     *   foreignKeysRequired {boolean} - FK obligatorias (no permite null)
     *   timestamps          {boolean} - Añade createdAt / updatedAt automáticamente
     *   softDelete          {boolean} - Marca deletedAt en vez de borrar físicamente
     *   readonly            {boolean} - Bloquea add, update y delete
     *   maxRegistros        {number}  - Límite máximo de filas
     *
     * Otras propiedades por tabla:
     *   schema  {Object} - { campo: { type, required, default } }
     *   hooks   {Object} - { beforeAdd, afterAdd, beforeUpdate, afterUpdate,
     *                         beforeDelete, afterDelete }
     *   indices {Array}  - ['campo1', 'campo2'] campos indexados en memoria
     */
    constructor(tablas = [], carpeta = './data') {
        this.carpeta  = carpeta;
        this.tablas   = tablas.map(t => this.#buildTableEntry(t));
        this.#indices = {};
    }

    // ─────────────────────────────────────────────
    //  PRIVATE STATE
    // ─────────────────────────────────────────────

    #indices = {};   // { tablaNombre: { campo: { valor: [registros] } } }

    // ─────────────────────────────────────────────
    //  INTERNAL HELPERS
    // ─────────────────────────────────────────────

    #buildTableEntry(tablaConfig) {
        return {
            ...tablaConfig,
            path: join(this.carpeta, `${tablaConfig.nombre}.json`)
        };
    }

    #findTable(tabla) {
        return this.tablas.find(e => e.nombre === tabla);
    }

    #requireTable(tabla) {
        const t = this.#findTable(tabla);
        if (!t) throw new Error(`Tabla "${tabla}" no encontrada`);
        return t;
    }

    async #readTable(tablaArchivo) {
        const rawData = await readFile(tablaArchivo.path, 'utf-8');
        return JSON.parse(rawData);
    }

    async #writeTable(tablaArchivo, datos) {
        await writeFile(tablaArchivo.path, JSON.stringify(datos, null, 2), 'utf-8');
        this.#rebuildIndex(tablaArchivo, datos);
    }

    #stripInternal({ path: _p, ...config }) {
        return config;
    }

    // ── Readonly guard ────────────────────────────

    #assertWritable(tablaArchivo, operacion) {
        if (tablaArchivo.options?.readonly) {
            throw new Error(
                `La tabla "${tablaArchivo.nombre}" es de solo lectura (operación: ${operacion})`
            );
        }
    }

    // ── Timestamps ───────────────────────────────

    #applyTimestampCreate(tablaArchivo, registro) {
        if (!tablaArchivo.options?.timestamps) return registro;
        const now = new Date().toISOString();
        return { ...registro, createdAt: now, updatedAt: now };
    }

    #applyTimestampUpdate(tablaArchivo, registro) {
        if (!tablaArchivo.options?.timestamps) return registro;
        return { ...registro, updatedAt: new Date().toISOString() };
    }

    // ── Schema validation ─────────────────────────

    #validateSchema(tablaArchivo, registro, esUpdate = false) {
        const schema = tablaArchivo.schema;
        if (!schema) return registro;

        // ── Rama 1: LuneModels.schema() completo ──────────────────────────────
        // Tiene .validate(data) que opera sobre el objeto entero.
        // En update parcial lo saltamos porque el schema completo espera todos
        // los campos y no tenemos acceso a los defaults aquí.
        if (isLuneSchema(schema)) {
            if (esUpdate) return registro; // update parcial: sin validación de schema completo

            const { valid, errors, value } = schema.validate(registro);
            if (!valid) {
                const resumen = Object.entries(errors)
                    .map(([k, v]) => `"${k}": ${typeof v === 'object' ? JSON.stringify(v) : v}`)
                    .join(', ');
                throw new Error(
                    `Error de validación en "${tablaArchivo.nombre}": { ${resumen} }`
                );
            }
            // value contiene los campos validados (con defaults aplicados por LuneModels)
            return { ...registro, ...value };
        }

        // ── Rama 2: definición campo a campo ──────────────────────────────────
        // Puede ser nativo { campo: { type, required, default } }
        // o con validadores sueltos de LuneModels { campo: LuneModels.string()... }
        const resultado = { ...registro };

        for (const [campo, reglas] of Object.entries(schema)) {

            // ── Rama 2a: validador suelto de LuneModels ───────────────────────
            if (isLuneValidator(reglas)) {
                // En update parcial, solo validar campos presentes en nuevosDatos
                if (esUpdate && !(campo in resultado)) continue;

                const result = reglas.validate(resultado[campo]);
                if (result !== true) {
                    const mensaje = typeof result === 'object'
                        ? JSON.stringify(result)
                        : result;
                    throw new Error(
                        `Error de validación en "${tablaArchivo.nombre}", campo "${campo}": ${mensaje}`
                    );
                }
                continue;
            }

            // ── Rama 2b: schema nativo { type, required, default } ────────────
            let valor = resultado[campo];

            // Aplicar default si el campo no viene y no es update parcial
            if (valor === undefined && !esUpdate && reglas.default !== undefined) {
                valor = typeof reglas.default === 'function'
                    ? reglas.default()
                    : reglas.default;
                resultado[campo] = valor;
            }

            // Required (solo en inserciones)
            if (!esUpdate && reglas.required && (valor === undefined || valor === null)) {
                throw new Error(
                    `El campo "${campo}" es obligatorio en "${tablaArchivo.nombre}"`
                );
            }

            // Validación de tipo (solo si el valor está presente)
            if (valor !== undefined && valor !== null && reglas.type) {
                const validator = TYPE_VALIDATORS[reglas.type];
                if (validator && !validator(valor)) {
                    throw new Error(
                        `El campo "${campo}" debe ser de tipo "${reglas.type}" en "${tablaArchivo.nombre}"`
                    );
                }
            }
        }

        return resultado;
    }

    // ── Foreign keys ──────────────────────────────

    async #validateForeignKeys(tablaArchivo, nuevosArray) {
        if (!tablaArchivo.foreignKeys?.length) return;

        for (const fk of tablaArchivo.foreignKeys) {
            const tablaForanea = this.#findTable(fk.nombre);
            if (!tablaForanea) throw new Error(`Tabla foránea "${fk.nombre}" no encontrada`);

            const datosForaneos = await this.#readTable(tablaForanea);
            const valoresValidos = new Set(datosForaneos.map(d => d[fk.foreignField]));

            for (const nuevo of nuevosArray) {
                const valorLocal = nuevo[fk.localField];

                if (valorLocal == null) {
                    if (tablaArchivo.options?.foreignKeysRequired) {
                        throw new Error(
                            `El campo "${fk.localField}" es obligatorio en "${tablaArchivo.nombre}"`
                        );
                    }
                    continue;
                }

                if (!valoresValidos.has(valorLocal)) {
                    throw new Error(
                        `Foreign key inválida: "${fk.localField}" con valor "${valorLocal}" ` +
                        `no existe en "${fk.nombre}.${fk.foreignField}"`
                    );
                }
            }
        }
    }

    // ── Hooks ─────────────────────────────────────

    async #runHook(tablaArchivo, nombre, payload) {
        const hook = tablaArchivo.hooks?.[nombre];
        if (typeof hook === 'function') await hook(payload);
    }

    // ── Indices ───────────────────────────────────

    #rebuildIndex(tablaArchivo, datos) {
        const campos = tablaArchivo.indices;
        if (!campos?.length) return;

        const idx = {};
        for (const campo of campos) {
            idx[campo] = {};
            for (const registro of datos) {
                const val = registro[campo];
                if (val === undefined) continue;
                const key = String(val);
                if (!idx[campo][key]) idx[campo][key] = [];
                idx[campo][key].push(registro);
            }
        }

        this.#indices[tablaArchivo.nombre] = idx;
    }

    // ─────────────────────────────────────────────
    //  INIT
    // ─────────────────────────────────────────────

    async init() {
        await mkdir(this.carpeta, { recursive: true });

        for (const tabla of this.tablas) {
            try {
                await access(tabla.path);
                // Construir índices con los datos existentes
                const datos = await this.#readTable(tabla);
                this.#rebuildIndex(tabla, datos);
            } catch {
                await this.#writeTable(tabla, []);
            }
        }
    }

    // ─────────────────────────────────────────────
    //  RECORDS — CRUD
    // ─────────────────────────────────────────────

    /**
     * Obtiene registros de una tabla.
     * Si softDelete está activo excluye los registros borrados por defecto.
     */
    async get(tabla, filtro = () => true) {
        const tablaArchivo = this.#requireTable(tabla);
        const data = await this.#readTable(tablaArchivo);

        const base = tablaArchivo.options?.softDelete
            ? data.filter(r => !r.deletedAt)
            : data;

        return base.filter(filtro);
    }

    async add(tabla, nuevosDatos) {
        const tablaArchivo = this.#requireTable(tabla);
        this.#assertWritable(tablaArchivo, 'add');

        const datosExistentes = await this.#readTable(tablaArchivo);
        const nuevosArray = Array.isArray(nuevosDatos) ? nuevosDatos : [nuevosDatos];

        // maxRegistros
        const max = tablaArchivo.options?.maxRegistros;
        if (max != null && datosExistentes.length + nuevosArray.length > max) {
            throw new Error(
                `La tabla "${tabla}" ha alcanzado el límite máximo de ${max} registros`
            );
        }

        await this.#validateForeignKeys(tablaArchivo, nuevosArray);

        const nuevosProcesados = nuevosArray.map(nuevo => {
            // Schema: defaults + validación de tipos
            nuevo = this.#validateSchema(tablaArchivo, nuevo, false);

            // Auto-increment
            if (tablaArchivo.options?.idAutoIncrementable && nuevo[tablaArchivo.id] == null) {
                const maxId = datosExistentes.length
                    ? Math.max(...datosExistentes.map(d => d[tablaArchivo.id] || 0))
                    : 0;
                nuevo[tablaArchivo.id] = maxId + 1;
            }

            // Unique id
            if (tablaArchivo.options?.idUnique && nuevo[tablaArchivo.id] != null) {
                const existe = datosExistentes.some(d => d[tablaArchivo.id] === nuevo[tablaArchivo.id]);
                if (existe) throw new Error(`El ID ${nuevo[tablaArchivo.id]} ya existe en "${tabla}"`);
            }

            return this.#applyTimestampCreate(tablaArchivo, nuevo);
        });

        await this.#runHook(tablaArchivo, 'beforeAdd', { tabla, datos: nuevosProcesados });

        const datosActualizados = [...datosExistentes, ...nuevosProcesados];
        await this.#writeTable(tablaArchivo, datosActualizados);

        await this.#runHook(tablaArchivo, 'afterAdd', { tabla, datos: nuevosProcesados });

        return datosActualizados;
    }

    async update(tabla, filtro, nuevosDatos) {
        const tablaArchivo = this.#requireTable(tabla);
        this.#assertWritable(tablaArchivo, 'update');

        const datosExistentes = await this.#readTable(tablaArchivo);

        // Validar FK solo sobre los campos que se van a actualizar
        const fksAfectadas = (tablaArchivo.foreignKeys || []).filter(fk => fk.localField in nuevosDatos);
        if (fksAfectadas.length) {
            await this.#validateForeignKeys({ ...tablaArchivo, foreignKeys: fksAfectadas }, [nuevosDatos]);
        }

        nuevosDatos = this.#validateSchema(tablaArchivo, nuevosDatos, true);

        let actualizados = 0;

        await this.#runHook(tablaArchivo, 'beforeUpdate', { tabla, filtro, nuevosDatos });

        const datosActualizados = datosExistentes.map(registro => {
            if (!filtro(registro)) return registro;

            actualizados++;

            let registroActualizado = { ...registro, ...nuevosDatos };

            // Proteger el id
            if (tablaArchivo.options?.idUnique || tablaArchivo.options?.idAutoIncrementable) {
                registroActualizado[tablaArchivo.id] = registro[tablaArchivo.id];
            }

            return this.#applyTimestampUpdate(tablaArchivo, registroActualizado);
        });

        if (actualizados === 0) {
            throw new Error(
                `No se encontraron registros que coincidan con el filtro en "${tabla}"`
            );
        }

        await this.#writeTable(tablaArchivo, datosActualizados);
        await this.#runHook(tablaArchivo, 'afterUpdate', { tabla, actualizados });

        return datosActualizados;
    }

    async delete(tabla, filtro = () => true) {
        const tablaArchivo = this.#requireTable(tabla);
        this.#assertWritable(tablaArchivo, 'delete');

        const datosExistentes = await this.#readTable(tablaArchivo);
        const registrosEliminados = datosExistentes.filter(filtro);

        if (registrosEliminados.length === 0) return datosExistentes;

        // ── Soft delete ───────────────────────────
        if (tablaArchivo.options?.softDelete) {
            await this.#runHook(tablaArchivo, 'beforeDelete', { tabla, registros: registrosEliminados });

            const ahora = new Date().toISOString();
            const datosActualizados = datosExistentes.map(r =>
                filtro(r) ? { ...r, deletedAt: ahora } : r
            );

            await this.#writeTable(tablaArchivo, datosActualizados);
            await this.#runHook(tablaArchivo, 'afterDelete', { tabla, registros: registrosEliminados });

            return datosActualizados.filter(r => !r.deletedAt);
        }

        // ── Hard delete: comprobar integridad referencial ──
        for (const otraTabla of this.tablas) {
            if (otraTabla.nombre === tabla) continue;

            const fksHaciaEstaTabla = (otraTabla.foreignKeys || []).filter(fk => fk.nombre === tabla);
            if (!fksHaciaEstaTabla.length) continue;

            const datosOtraTabla = await this.#readTable(otraTabla);

            for (const fk of fksHaciaEstaTabla) {
                const valoresEliminados = new Set(registrosEliminados.map(r => r[fk.foreignField]));
                const tieneReferencias = datosOtraTabla.some(r => valoresEliminados.has(r[fk.localField]));

                if (tieneReferencias) {
                    throw new Error(
                        `No se puede eliminar: "${otraTabla.nombre}" tiene registros ` +
                        `que referencian "${tabla}.${fk.foreignField}"`
                    );
                }
            }
        }

        await this.#runHook(tablaArchivo, 'beforeDelete', { tabla, registros: registrosEliminados });

        const datosRestantes = datosExistentes.filter(r => !filtro(r));
        await this.#writeTable(tablaArchivo, datosRestantes);

        await this.#runHook(tablaArchivo, 'afterDelete', { tabla, registros: registrosEliminados });

        return datosRestantes;
    }

    // ─────────────────────────────────────────────
    //  RECORDS — EXTRA
    // ─────────────────────────────────────────────

    /** Devuelve el primer registro que cumple el filtro, o undefined */
    async find(tabla, filtro) {
        const resultados = await this.get(tabla, filtro);
        return resultados[0];
    }

    /** Devuelve true si existe al menos un registro que cumple el filtro */
    async exists(tabla, filtro) {
        return (await this.find(tabla, filtro)) !== undefined;
    }

    /** Devuelve el número de registros (con filtro opcional) */
    async count(tabla, filtro = () => true) {
        return (await this.get(tabla, filtro)).length;
    }

    /** Vacía todos los registros de una tabla sin eliminarla */
    async clear(tabla) {
        const tablaArchivo = this.#requireTable(tabla);
        this.#assertWritable(tablaArchivo, 'clear');
        await this.#writeTable(tablaArchivo, []);
        return [];
    }

    /**
     * Inserta datos iniciales solo si la tabla está vacía.
     * Ideal para desarrollo / fixtures.
     */
    async seed(tabla, datos) {
        const tablaArchivo = this.#requireTable(tabla);
        const existentes   = await this.#readTable(tablaArchivo);
        if (existentes.length > 0) return existentes;
        return this.add(tabla, datos);
    }

    /**
     * Join en memoria entre dos tablas.
     * @param {string} tabla        - Tabla principal
     * @param {string} tablaForanea - Tabla con la que hacer join
     * @param {string} campoLocal   - Campo de la tabla principal
     * @param {string} campoForaneo - Campo de la tabla foránea (por defecto igual a campoLocal)
     * @param {string} alias        - Nombre con el que se embebe el objeto foráneo
     */
    async join(tabla, tablaForanea, campoLocal, campoForaneo = campoLocal, alias = tablaForanea) {
        this.#requireTable(tabla);
        const foranArch = this.#requireTable(tablaForanea);

        const datos    = await this.get(tabla);
        const foraneos = await this.#readTable(foranArch);
        const mapa     = new Map(foraneos.map(r => [r[campoForaneo], r]));

        return datos.map(registro => ({
            ...registro,
            [alias]: mapa.get(registro[campoLocal]) ?? null
        }));
    }

    /**
     * Búsqueda usando el índice en memoria para una coincidencia exacta.
     * Si el campo no está indexado hace un get normal como fallback.
     */
    async findByIndex(tabla, campo, valor) {
        this.#requireTable(tabla);
        const idx = this.#indices[tabla]?.[campo];

        if (idx) return idx[String(valor)] ?? [];
        return this.get(tabla, r => r[campo] === valor);
    }

    // ─────────────────────────────────────────────
    //  SOFT DELETE — EXTRA
    // ─────────────────────────────────────────────

    /** Devuelve los registros marcados como borrados */
    async getDeleted(tabla) {
        const tablaArchivo = this.#requireTable(tabla);
        if (!tablaArchivo.options?.softDelete) {
            throw new Error(`La tabla "${tabla}" no tiene softDelete activo`);
        }
        const data = await this.#readTable(tablaArchivo);
        return data.filter(r => r.deletedAt);
    }

    /** Restaura registros previamente borrados con softDelete */
    async restore(tabla, filtro) {
        const tablaArchivo = this.#requireTable(tabla);
        this.#assertWritable(tablaArchivo, 'restore');

        if (!tablaArchivo.options?.softDelete) {
            throw new Error(`La tabla "${tabla}" no tiene softDelete activo`);
        }

        const data = await this.#readTable(tablaArchivo);
        let restaurados = 0;

        const datosActualizados = data.map(r => {
            if (!r.deletedAt || !filtro(r)) return r;
            restaurados++;
            const { deletedAt: _d, ...resto } = r;
            return resto;
        });

        if (restaurados === 0) {
            throw new Error(
                `No se encontraron registros eliminados que coincidan con el filtro en "${tabla}"`
            );
        }

        await this.#writeTable(tablaArchivo, datosActualizados);
        return datosActualizados.filter(r => !r.deletedAt);
    }

    // ─────────────────────────────────────────────
    //  BACKUP / DROP
    // ─────────────────────────────────────────────

    /**
     * Copia todos los .json a una carpeta con timestamp.
     * @param {string} destino - Carpeta base para los backups
     * @returns {string} Ruta del backup generado
     */
    async backup(destino = './backups') {
        const timestamp  = new Date().toISOString().replace(/[:.]/g, '-');
        const carpetaDst = join(destino, `backup-${timestamp}`);

        await mkdir(carpetaDst, { recursive: true });
        await cp(this.carpeta, carpetaDst, { recursive: true });

        return carpetaDst;
    }

    /**
     * Elimina TODAS las tablas y la carpeta entera.
     * Requiere confirmación explícita: drop({ confirmar: true })
     */
    async drop({ confirmar = false } = {}) {
        if (!confirmar) {
            throw new Error(
                'drop() es una operación destructiva. Llámalo con { confirmar: true } para ejecutarlo.'
            );
        }

        for (const tabla of [...this.tablas]) {
            try { await unlink(tabla.path); } catch { /* ignorar si no existe */ }
        }

        this.tablas   = [];
        this.#indices = {};

        try {
            const { rmdir } = await import('fs/promises');
            await rmdir(this.carpeta);
        } catch { /* la carpeta puede no estar vacía o no existir */ }
    }

    // ─────────────────────────────────────────────
    //  TABLES — CRUD
    // ─────────────────────────────────────────────

    async getTable(tabla) {
        return this.#stripInternal(this.#requireTable(tabla));
    }

    async addTable(tablaConfig) {
        if (!tablaConfig?.nombre) {
            throw new Error('La configuración debe incluir un campo "nombre"');
        }
        if (this.#findTable(tablaConfig.nombre)) {
            throw new Error(`La tabla "${tablaConfig.nombre}" ya existe`);
        }

        await mkdir(this.carpeta, { recursive: true });

        const nuevaTabla = this.#buildTableEntry(tablaConfig);
        await this.#writeTable(nuevaTabla, []);
        this.tablas.push(nuevaTabla);

        return this.#stripInternal(nuevaTabla);
    }

    async updateTable(tabla, config) {
        const index = this.tablas.findIndex(e => e.nombre === tabla);
        if (index === -1) throw new Error(`Tabla "${tabla}" no encontrada`);

        const { nombre: _n, path: _p, ...restoConfig } = config;
        this.tablas[index] = { ...this.tablas[index], ...restoConfig };

        return this.#stripInternal(this.tablas[index]);
    }

    async deleteTable(tabla) {
        const index = this.tablas.findIndex(e => e.nombre === tabla);
        if (index === -1) throw new Error(`Tabla "${tabla}" no encontrada`);

        for (const otraTabla of this.tablas) {
            if (otraTabla.nombre === tabla) continue;
            const tieneFK = (otraTabla.foreignKeys || []).some(fk => fk.nombre === tabla);
            if (tieneFK) {
                throw new Error(
                    `No se puede eliminar: "${otraTabla.nombre}" tiene una foreign key que referencia a "${tabla}"`
                );
            }
        }

        const [tablaEliminada] = this.tablas.splice(index, 1);
        delete this.#indices[tabla];

        try { await unlink(tablaEliminada.path); } catch { /* ignorar */ }

        return this.#stripInternal(tablaEliminada);
    }
}