/**
 * Configuración de una Foreign Key para una tabla
 */
export interface ForeignKey {
  /** Nombre de la tabla foránea a la que apunta */
  nombre: string;
  /** Campo en la tabla actual que actúa como clave foránea */
  localField: string;
  /** Campo en la tabla foránea al que referencia */
  foreignField: string;
}

/**
 * Opciones de comportamiento de una tabla
 */
export interface TablaOptions {
  /** Si el ID se genera automáticamente de forma incremental */
  idAutoIncrementable?: boolean;
  /** Si el ID debe ser único (no permite duplicados) */
  idUnique?: boolean;
  /** Si las foreign keys son obligatorias (no pueden ser null) */
  foreignKeysRequired?: boolean;
}

/**
 * Definición de una tabla de la base de datos
 */
export interface TablaConfig {
  /** Nombre identificador de la tabla */
  nombre: string;
  /** Nombre del campo que actúa como ID (por defecto se asume "id") */
  id?: string;
  /** Claves foráneas que referencia esta tabla */
  foreignKeys?: ForeignKey[];
  /** Opciones de comportamiento */
  options?: TablaOptions;
}

/**
 * Definición interna de una tabla (incluye el path del archivo)
 */
interface TablaInterna extends Required<Pick<TablaConfig, 'nombre'>> {
  id?: string;
  foreignKeys?: ForeignKey[];
  options: TablaOptions;
  /** Ruta al archivo .json de la tabla */
  path: string;
}

/**
 * ## LuneDataBase
 * Base de datos local basada en archivos JSON con soporte de tablas,
 * foreign keys, IDs auto-incrementables y filtros.
 *
 * @example
 * ```js
 * const db = new LuneDataBase([
 *   {
 *     nombre: 'usuarios',
 *     id: 'id',
 *     options: { idAutoIncrementable: true, idUnique: true }
 *   },
 *   {
 *     nombre: 'posts',
 *     id: 'id',
 *     options: { idAutoIncrementable: true, idUnique: true },
 *     foreignKeys: [{ nombre: 'usuarios', localField: 'userId', foreignField: 'id' }]
 *   }
 * ]);
 *
 * await db.init();
 * ```
 */
export default class LuneDataBase {
  /** Ruta a la carpeta donde se almacenan los archivos JSON */
  carpeta: string;

  /** Lista de tablas registradas (con path incluido) */
  tablas: TablaInterna[];

  /**
   * Crea una nueva instancia de LuneDataBase.
   * @param tablas - Array con la configuración de cada tabla
   * @param carpeta - Carpeta donde se guardarán los archivos JSON (por defecto `'./data'`)
   *
   * @example
   * ```js
   * const db = new LuneDataBase([
   *   { nombre: 'usuarios', id: 'id', options: { idAutoIncrementable: true } }
   * ], './mi-base-de-datos');
   * ```
   */
  constructor(tablas?: TablaConfig[], carpeta?: string);

  /**
   * Inicializa la base de datos: crea la carpeta y los archivos JSON
   * de cada tabla si no existen.
   *
   * ⚠️ Debe llamarse antes de cualquier operación con la base de datos.
   *
   * @example
   * ```js
   * await db.init();
   * ```
   */
  init(): Promise<void>;

  /**
   * Obtiene registros de una tabla, opcionalmente filtrados.
   *
   * @param tabla - Nombre de la tabla a consultar
   * @param filtro - Función de filtro (similar a `Array.filter`). Por defecto devuelve todos.
   * @returns Array con los registros que pasan el filtro
   *
   * @example
   * ```js
   * // Todos los registros
   * const todos = await db.get('usuarios');
   *
   * // Solo los activos
   * const activos = await db.get('usuarios', u => u.activo === true);
   * ```
   */
  get<T = Record<string, any>>(tabla: string, filtro?: (registro: T) => boolean): Promise<T[]>;

  /**
   * Agrega uno o varios registros a una tabla.
   * Valida foreign keys e IDs únicos si están configurados.
   *
   * @param tabla - Nombre de la tabla destino
   * @param nuevosDatos - Un objeto o array de objetos a insertar
   * @returns Array completo de registros tras la inserción
   *
   * @example
   * ```js
   * // Insertar uno
   * await db.add('usuarios', { nombre: 'Ana', activo: true });
   *
   * // Insertar varios
   * await db.add('usuarios', [
   *   { nombre: 'Luis' },
   *   { nombre: 'María' }
   * ]);
   * ```
   */
  add<T = Record<string, any>>(tabla: string, nuevosDatos: T | T[]): Promise<T[]>;

  /**
   * Actualiza los registros que coincidan con el filtro.
   * Si la tabla tiene ID único/autoincremental, el ID no puede modificarse.
   *
   * @param tabla - Nombre de la tabla a actualizar
   * @param filtro - Función que determina qué registros se actualizan
   * @param nuevosDatos - Objeto con los campos a modificar (se hace merge)
   * @returns Array completo de registros tras la actualización
   *
   * @example
   * ```js
   * await db.update(
   *   'usuarios',
   *   u => u.id === 1,
   *   { nombre: 'Ana García', activo: false }
   * );
   * ```
   */
  update<T = Record<string, any>>(
    tabla: string,
    filtro: (registro: T) => boolean,
    nuevosDatos: Partial<T>
  ): Promise<T[]>;

  /**
   * Elimina los registros que coincidan con el filtro.
   * Lanza un error si otros registros en otras tablas referencian los que se quieren eliminar.
   *
   * @param tabla - Nombre de la tabla
   * @param filtro - Función que determina qué registros se eliminan. Por defecto elimina todos.
   * @returns Array con los registros que **no** fueron eliminados
   *
   * @example
   * ```js
   * // Eliminar por condición
   * await db.delete('usuarios', u => u.id === 3);
   *
   * // Vaciar tabla completa
   * await db.delete('usuarios');
   * ```
   */
  delete<T = Record<string, any>>(tabla: string, filtro?: (registro: T) => boolean): Promise<T[]>;

  /**
   * Devuelve la configuración interna de una tabla por su nombre.
   * Retorna `undefined` si la tabla no existe.
   *
   * @param tabla - Nombre de la tabla a buscar
   *
   * @example
   * ```js
   * const config = db.getTabla('usuarios');
   * console.log(config?.path); // './data/usuarios.json'
   * ```
   */
  getTabla(tabla: string): TablaInterna | undefined;
}