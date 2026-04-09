/**
 * Configuración de una Foreign Key para una tabla
 */
export interface ForeignKey {
  /** Nombre de la tabla foránea a la que apunta */
  tableName: string
  /** Campo en la tabla actual que actúa como clave foránea */
  localField: string
  /** Campo en la tabla foránea al que referencia */
  foreignField: string
}

/**
 * Opciones de comportamiento de una tabla
 */
export interface TablaOptions {
  /** Si el ID se genera automáticamente de forma incremental */
  idAutoIncrementable?: boolean
  /** Si el ID debe ser único (no permite duplicados) */
  idUnique?: boolean
  /** Si las foreign keys son obligatorias (no pueden ser null) */
  foreignKeysRequired?: boolean
  /** Si la tabla mantiene timestamps (createdAt y updatedAt) */
  timestamps?: boolean
  /** Si la tabla soporta soft delete (deletedAt) */
  softDelete?: boolean
  /** Si la tabla es solo lectura */
  readonly?: boolean
}

/**
 * Definición de una tabla de la base de datos
 */
export interface TablaConfig {
  /** Nombre identificador de la tabla */
  name: string
  /** Nombre del campo que actúa como ID (por defecto se asume "id") */
  id?: string
  /** Claves foráneas que referencia esta tabla */
  foreignKeys?: ForeignKey[]
  /** Campos a indexar */
  indices?: string[]
  /** Opciones de comportamiento */
  options?: TablaOptions
  /** Hooks para eventos */
  hooks?: {
    beforeAdd?: (payload: { table: string, datos: Record<string, any>[] }) => void | Promise<void>
    afterAdd?: (payload: { table: string, datos: Record<string, any>[] }) => void | Promise<void>
    beforeUpdate?: (payload: { table: string, filter: (r:any)=>boolean, newData: Record<string, any> }) => void | Promise<void>
    afterUpdate?: (payload: { table: string, actualizados: number }) => void | Promise<void>
    beforeDelete?: (payload: { table: string, registros: Record<string, any>[] }) => void | Promise<void>
    afterDelete?: (payload: { table: string, registros: Record<string, any>[] }) => void | Promise<void>
  }
}

/**
 * Definición interna de una tabla (incluye el path del archivo)
 */
interface TablaInterna extends Required<Pick<TablaConfig,'name'>> {
  id?: string
  foreignKeys?: ForeignKey[]
  indices?: string[]
  options: TablaOptions
  hooks?: TablaConfig['hooks']
  /** Ruta al archivo .json de la tabla */
  path: string
}

/**
 * ## LuneDatabase
 * Base de datos local basada en archivos JSON con soporte de tablas,
 * foreign keys, soft delete, timestamps, índices y hooks.
 */
export default class LuneDatabase {
  /** Carpeta donde se almacenan los archivos JSON */
  path: string
  /** Lista de tablas registradas (con path incluido) */
  tables: TablaInterna[]
  /** Flag de base de datos in-memory */
  inMemory: boolean

  constructor(tables?: TablaConfig[], options?: { path?: string, inMemory?: boolean })

  /** Inicializa la base de datos y crea archivos/carpetas si no existen */
  init(): Promise<void>

  /** Devuelve todos los registros, opcionalmente filtrados */
  get<T = Record<string, any>>(table: string, filter?: (r:T)=>boolean): Promise<T[]>

  /** Devuelve solo el primer registro que cumpla el filtro */
  find<T = Record<string, any>>(table: string, filter: (r:T)=>boolean): Promise<T | undefined>

  /** Verifica si existe al menos un registro que cumpla el filtro */
  exists<T = Record<string, any>>(table: string, filter: (r:T)=>boolean): Promise<boolean>

  /** Cuenta los registros que cumplen un filtro */
  count<T = Record<string, any>>(table: string, filter?: (r:T)=>boolean): Promise<number>

  /** Inserta uno o varios registros en la tabla */
  add<T = Record<string, any>>(table: string, newRecords: T | T[]): Promise<T[]>

  /** Actualiza registros que cumplen un filtro */
  update<T = Record<string, any>>(table: string, filter: (r:T)=>boolean, newData: Partial<T>): Promise<T[]>

  /** Actualiza todos los registros de la tabla */
  updateAll<T = Record<string, any>>(table: string, newData: Partial<T>): Promise<T[]>

  /** Elimina registros que cumplen un filtro (soft delete si está activo) */
  delete<T = Record<string, any>>(table: string, filter?: (r:T)=>boolean): Promise<T[]>

  /** Recupera los registros soft-deleted */
  getDeleted<T = Record<string, any>>(table: string): Promise<T[]>

  /** Restaura registros eliminados */
  restore<T = Record<string, any>>(table: string, filter: (r:T)=>boolean): Promise<T[]>

  /** Limpia completamente la tabla */
  clear(table: string): Promise<void>

  /** Inserta datos solo si la tabla está vacía */
  seed<T = Record<string, any>>(table: string, data: T | T[]): Promise<T[]>

  /** Realiza un join con otra tabla */
  join<T = Record<string, any>>(tableName: string, foreignTableName: string, localField: string, foreignField?: string, alias?: string): Promise<T[]>

  /** Busca registros usando un índice */
  findByIndex<T = Record<string, any>>(tableName: string, field: string, value: any): Promise<T[]>

  /** Hace backup de todos los archivos JSON en otra carpeta */
  backup(dest?: string): Promise<string>

  /** Elimina todos los archivos y tablas registradas (destructivo) */
  drop(options?: { confirmar?: boolean }): Promise<void>

  /** Devuelve la configuración interna de una tabla */
  getTable(tableName: string): Promise<TablaInterna>

  /** Crea una nueva tabla */
  createTable(tableConfig: TablaConfig): Promise<TablaInterna>

  /** Actualiza la configuración de una tabla existente */
  updateTable(tableName: string, config: Partial<TablaConfig>): Promise<TablaInterna>

  /** Elimina una tabla (archivo + registro interno) */
  deleteTable(tableName: string): Promise<TablaInterna>
}