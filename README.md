# LuneDatabase

Base de datos local ligera basada en archivos `.json`. Sin dependencias externas, con soporte completo de CRUD para registros y tablas, validación de esquemas (compatible con **LuneModels**), foreign keys, soft delete, hooks, índices en memoria y backups.

---

## Índice

- [Instalación](#instalación)
- [Inicio rápido](#inicio-rápido)
- [Configuración de tablas](#configuración-de-tablas)
  - [Propiedades principales](#propiedades-principales)
  - [options](#options)
  - [schema](#schema)
  - [foreignKeys](#foreignkeys)
  - [hooks](#hooks)
  - [indices](#indices)
- [API — Registros](#api--registros)
  - [get](#gettabla-filtro)
  - [add](#addtabla-datos)
  - [update](#updatetabla-filtro-datos)
  - [delete](#deletetabla-filtro)
  - [find](#findtabla-filtro)
  - [exists](#existstabla-filtro)
  - [count](#counttabla-filtro)
  - [clear](#cleartabla)
  - [seed](#seedtabla-datos)
  - [join](#jointabla-tablaforanea-campolocal-campoforaneo-alias)
  - [findByIndex](#findbyindextabla-campo-valor)
- [API — Soft Delete](#api--soft-delete)
  - [getDeleted](#getdeletedtabla)
  - [restore](#restoretabla-filtro)
- [API — Tablas](#api--tablas)
  - [getTable](#gettabletabla)
  - [addTable](#addtabletablaconfig)
  - [updateTable](#updatetabletabla-config)
  - [deleteTable](#deletetabletabla)
- [API — Global](#api--global)
  - [init](#init)
  - [backup](#backupdestino)
  - [drop](#dropconfirmar)
- [Ejemplo completo](#ejemplo-completo)

---

## Instalación

Copia `LuneDatabase.js` a tu proyecto e impórtalo directamente. No tiene dependencias externas; solo usa el módulo nativo `fs/promises` de Node.js.

```js
import LuneDatabase from './LuneDatabase.js'
```

Para usar validaciones avanzadas en el `schema`, puedes combinarla con **LuneModels** (opcional):

```js
import LuneModels from './LuneModels.js'
```

> Requiere **Node.js 16+** (por el uso de private class fields y `fs/promises`).

---

## Inicio rápido

```js
import LuneDatabase from './LuneDatabase.js'

const db = new LuneDatabase(
  [
    {
      nombre: 'usuarios',
      id: 'id',
      options: {
        idAutoIncrementable: true,
        idUnique: true,
        timestamps: true,
      },
    },
  ],
  './data' // carpeta donde se guardan los .json (opcional, por defecto './data')
)

await db.init()

await db.add('usuarios', { nombre: 'Ana', email: 'ana@ejemplo.com' })

const todos = await db.get('usuarios')
console.log(todos)
```

---

## Configuración de tablas

Cada tabla se define como un objeto con las siguientes propiedades. Se pasan en el array del constructor o mediante `addTable()`.

### Propiedades principales

| Propiedad      | Tipo     | Descripción                                                  |
|----------------|----------|--------------------------------------------------------------|
| `nombre`       | `string` | **Obligatorio.** Nombre de la tabla (y del archivo `.json`). |
| `id`           | `string` | Campo que actúa como clave primaria (ej. `'id'`).            |
| `options`      | `object` | Comportamientos automáticos. Ver tabla de opciones.          |
| `schema`       | `object` | Definición de campos con tipo, obligatoriedad y defaults.    |
| `foreignKeys`  | `array`  | Relaciones con otras tablas.                                 |
| `hooks`        | `object` | Funciones que se ejecutan antes/después de cada operación.   |
| `indices`      | `array`  | Campos indexados en memoria para búsquedas rápidas.          |

---

### `options`

```js
options: {
  idAutoIncrementable: true,   // Asigna id numérico automático si no se provee
  idUnique: true,              // Lanza error si el id ya existe
  foreignKeysRequired: true,   // FK obligatorias (no permite null en campos FK)
  timestamps: true,            // Añade createdAt y updatedAt automáticamente
  softDelete: true,            // Marca deletedAt en vez de borrar físicamente
  readonly: true,              // Bloquea add, update, delete y clear
  maxRegistros: 1000,          // Límite máximo de filas
}
```

| Opción                | Tipo      | Efecto                                                                                   |
|-----------------------|-----------|------------------------------------------------------------------------------------------|
| `idAutoIncrementable` | `boolean` | Genera automáticamente el `id` como `maxId + 1` si no se incluye en el registro.        |
| `idUnique`            | `boolean` | Lanza error si se intenta insertar un registro con un `id` ya existente.                 |
| `foreignKeysRequired` | `boolean` | Lanza error si un campo de FK viene como `null` o `undefined`.                           |
| `timestamps`          | `boolean` | Añade `createdAt` y `updatedAt` (ISO 8601) en `add`; actualiza `updatedAt` en `update`. |
| `softDelete`          | `boolean` | `delete` marca `deletedAt` en vez de borrar. `get` excluye estos registros por defecto. |
| `readonly`            | `boolean` | Bloquea cualquier operación de escritura con un error descriptivo.                       |
| `maxRegistros`        | `number`  | Impide `add` si el número de filas existentes + las nuevas supera el límite.             |

---

### `schema`

Permite validar y normalizar los datos antes de insertarlos o actualizarlos. La detección del formato es **automática**: no hace falta configurar nada extra.

Se aceptan tres formatos, que pueden mezclarse libremente entre tablas:

---

#### Formato A — Schema nativo

Objeto plano donde cada campo define `type`, `required` y/o `default`.

```js
schema: {
  nombre:   { type: 'string',  required: true },
  email:    { type: 'string',  required: true },
  edad:     { type: 'number',  default: 18 },
  activo:   { type: 'boolean', default: true },
  tags:     { type: 'array' },
  meta:     { type: 'object' },
  creadoEn: { type: 'string',  default: () => new Date().toISOString() },
}
```

| Propiedad  | Tipo                | Descripción                                                                      |
|------------|---------------------|----------------------------------------------------------------------------------|
| `type`     | `string`            | Tipo esperado: `'string'`, `'number'`, `'boolean'`, `'array'`, `'object'`.      |
| `required` | `boolean`           | Si es `true`, lanza error cuando el campo está ausente o es `null` en un `add`. |
| `default`  | `any` o `() => any` | Valor por defecto si el campo no viene. Acepta funciones.                        |

---

#### Formato B — Validadores sueltos de LuneModels

Cada campo es un validador creado con `LuneModels`. Permite reglas avanzadas como `minLength`, `max`, `custom`, arrays tipados, objetos anidados, etc.

```js
import LuneModels from './LuneModels.js'

schema: {
  nombre:   LuneModels.string().required().minLength(2).maxLength(50),
  email:    LuneModels.string().required(),
  edad:     LuneModels.number().min(0).max(120),
  activo:   LuneModels.string(),
  tags:     LuneModels.array(LuneModels.string()).minElements(1),
  direccion: LuneModels.object({
    ciudad: LuneModels.string().required(),
    cp:     LuneModels.number(),
  }),
}
```

En `update` parcial solo se validan los campos presentes en `nuevosDatos`. Los campos ausentes se ignoran.

---

#### Formato C — Schema completo de LuneModels

Se pasa directamente el resultado de `LuneModels.schema({...})`. El objeto entero se valida de una sola vez, lo que permite tener toda la lógica de validación centralizada fuera de la configuración de la tabla.

```js
import LuneModels from './LuneModels.js'

const usuarioSchema = LuneModels.schema({
  nombre: LuneModels.string().required().minLength(2),
  email:  LuneModels.string().required(),
  edad:   LuneModels.number().min(0),
})

// En la tabla:
schema: usuarioSchema
```

> En `update` parcial este formato se omite intencionalmente, ya que el schema completo de LuneModels espera todos los campos definidos. Para updates con validación usa el **Formato B**.

---

> En todos los formatos, la validación en `update` es siempre **parcial**: solo afecta a los campos presentes en `nuevosDatos`.

---

### `foreignKeys`

Define relaciones con otras tablas. Se validan en `add` y en `update` (solo los campos que cambian).

```js
foreignKeys: [
  {
    nombre: 'categorias',   // Tabla referenciada
    localField: 'catId',    // Campo en esta tabla
    foreignField: 'id',     // Campo en la tabla referenciada
  }
]
```

Si el valor del campo local no existe en la tabla foránea, `add` y `update` lanzan un error. Si `options.foreignKeysRequired` es `true`, el campo tampoco puede ser `null`.

Al hacer `delete`, la librería comprueba automáticamente que ningún registro de otra tabla apunte al que se quiere eliminar. Si hay referencias, lanza un error de integridad referencial.

---

### `hooks`

Funciones asíncronas que se ejecutan antes o después de cada operación de escritura. Útiles para logs, auditoría, transformaciones externas o notificaciones.

```js
hooks: {
  beforeAdd:    async ({ tabla, datos })          => { /* ... */ },
  afterAdd:     async ({ tabla, datos })          => { /* ... */ },
  beforeUpdate: async ({ tabla, filtro, nuevosDatos }) => { /* ... */ },
  afterUpdate:  async ({ tabla, actualizados })   => { /* ... */ },
  beforeDelete: async ({ tabla, registros })      => { /* ... */ },
  afterDelete:  async ({ tabla, registros })      => { /* ... */ },
}
```

| Hook            | Cuándo se ejecuta                             | Payload                              |
|-----------------|-----------------------------------------------|--------------------------------------|
| `beforeAdd`     | Antes de escribir los nuevos registros        | `{ tabla, datos }`                   |
| `afterAdd`      | Después de escribir los nuevos registros      | `{ tabla, datos }`                   |
| `beforeUpdate`  | Antes de aplicar los cambios                  | `{ tabla, filtro, nuevosDatos }`     |
| `afterUpdate`   | Después de aplicar los cambios                | `{ tabla, actualizados }`            |
| `beforeDelete`  | Antes de borrar (hard o soft)                 | `{ tabla, registros }`               |
| `afterDelete`   | Después de borrar                             | `{ tabla, registros }`               |

---

### `indices`

Campos que se indexan en memoria cada vez que se escribe la tabla. Permiten usar `findByIndex()` para búsquedas O(1) en tablas grandes.

```js
indices: ['email', 'categoria']
```

Los índices se construyen automáticamente en `init()` a partir de los datos existentes y se reconstruyen después de cada `add`, `update` o `delete`.

---

## API — Registros

### `get(tabla, filtro?)`

Devuelve todos los registros que cumplen el filtro. Si `softDelete` está activo, excluye los registros con `deletedAt` por defecto.

```js
// Todos los registros
const usuarios = await db.get('usuarios')

// Con filtro
const activos = await db.get('usuarios', u => u.activo === true)
```

**Retorna:** `Array` de registros.

---

### `add(tabla, datos)`

Inserta uno o varios registros. Aplica validaciones de schema, FK, `idUnique`, `idAutoIncrementable`, `maxRegistros` y timestamps antes de escribir.

```js
// Un registro
await db.add('usuarios', { nombre: 'Carlos', email: 'carlos@ejemplo.com' })

// Varios registros
await db.add('usuarios', [
  { nombre: 'Ana' },
  { nombre: 'Luis' },
])
```

**Retorna:** `Array` con todos los registros de la tabla tras la inserción.

---

### `update(tabla, filtro, datos)`

Actualiza todos los registros que cumplen el filtro con los datos proporcionados. El campo `id` nunca se sobreescribe si `idUnique` o `idAutoIncrementable` están activos.

```js
await db.update(
  'usuarios',
  u => u.id === 3,
  { nombre: 'Carlos Actualizado' }
)
```

**Retorna:** `Array` con todos los registros de la tabla tras la actualización.  
**Lanza error** si ningún registro coincide con el filtro.

---

### `delete(tabla, filtro?)`

Elimina los registros que cumplen el filtro. Si `softDelete` está activo, marca `deletedAt` en lugar de borrar físicamente. Si no, comprueba integridad referencial antes de eliminar.

```js
// Eliminar por filtro
await db.delete('usuarios', u => u.id === 3)

// Eliminar todos (con softDelete solo los marca)
await db.delete('usuarios')
```

**Retorna:** `Array` con los registros visibles que quedan tras la operación.

---

### `find(tabla, filtro)`

Devuelve el **primer** registro que cumple el filtro, o `undefined` si no hay ninguno.

```js
const usuario = await db.find('usuarios', u => u.email === 'ana@ejemplo.com')
```

---

### `exists(tabla, filtro)`

Devuelve `true` si existe al menos un registro que cumple el filtro.

```js
const yaExiste = await db.exists('usuarios', u => u.email === 'ana@ejemplo.com')
```

---

### `count(tabla, filtro?)`

Devuelve el número de registros. Si no se pasa filtro, cuenta todos.

```js
const total     = await db.count('usuarios')
const activos   = await db.count('usuarios', u => u.activo === true)
```

---

### `clear(tabla)`

Elimina todos los registros de la tabla sin borrar la tabla en sí. Respeta `readonly`.

```js
await db.clear('logs')
```

**Retorna:** `[]`

---

### `seed(tabla, datos)`

Inserta los datos solo si la tabla está **vacía**. Si ya tiene registros, no hace nada y devuelve los existentes. Ideal para datos iniciales o fixtures de desarrollo.

```js
await db.seed('roles', [
  { id: 1, nombre: 'admin' },
  { id: 2, nombre: 'usuario' },
])
```

**Retorna:** `Array` con los registros de la tabla.

---

### `join(tabla, tablaForanea, campoLocal, campoForaneo?, alias?)`

Hace un join en memoria entre dos tablas usando un campo como clave de unión. El resultado embebe el registro foráneo dentro de cada registro principal.

```js
// Pedidos con el objeto usuario embebido
const pedidos = await db.join(
  'pedidos',      // tabla principal
  'usuarios',     // tabla foránea
  'usuarioId',    // campo en pedidos
  'id',           // campo en usuarios (por defecto igual a campoLocal)
  'usuario'       // alias en el resultado (por defecto el nombre de la tabla foránea)
)

// Resultado:
// { id: 1, usuarioId: 2, total: 99, usuario: { id: 2, nombre: 'Ana', ... } }
```

Si no se encuentra la contraparte foránea, el alias vale `null`.

---

### `findByIndex(tabla, campo, valor)`

Busca registros con coincidencia exacta usando el índice en memoria. Si el campo no está indexado, ejecuta un `get` normal como fallback transparente.

```js
// 'email' debe estar en tabla.indices para aprovechar el índice
const usuarios = await db.findByIndex('usuarios', 'email', 'ana@ejemplo.com')
```

**Retorna:** `Array` de registros que coinciden.

---

## API — Soft Delete

Disponible solo en tablas con `options.softDelete: true`.

### `getDeleted(tabla)`

Devuelve los registros marcados como eliminados (los que tienen `deletedAt`).

```js
const eliminados = await db.getDeleted('usuarios')
```

---

### `restore(tabla, filtro)`

Elimina el campo `deletedAt` de los registros que cumplen el filtro, restaurándolos.

```js
await db.restore('usuarios', u => u.id === 5)
```

**Retorna:** `Array` con los registros visibles tras la restauración.  
**Lanza error** si ningún registro eliminado coincide con el filtro.

---

## API — Tablas

### `getTable(tabla)`

Devuelve la configuración completa de una tabla (sin la ruta interna `path`).

```js
const config = await db.getTable('usuarios')
```

---

### `addTable(tablaConfig)`

Crea una nueva tabla en memoria y genera su archivo `.json` vacío. Lanza error si ya existe una tabla con ese nombre.

```js
await db.addTable({
  nombre: 'productos',
  id: 'id',
  options: { idAutoIncrementable: true, timestamps: true },
  schema: {
    nombre: { type: 'string', required: true },
    precio: { type: 'number', required: true },
  }
})
```

**Retorna:** La configuración de la tabla recién creada.

---

### `updateTable(tabla, config)`

Actualiza la configuración de una tabla existente en memoria. Los campos `nombre` y `path` son inmutables y se ignoran aunque se pasen.

```js
await db.updateTable('productos', {
  options: { readonly: true }
})
```

**Retorna:** La configuración actualizada de la tabla.

---

### `deleteTable(tabla)`

Elimina la tabla de memoria y borra su archivo `.json`. Lanza error si otra tabla la referencia como FK.

```js
await db.deleteTable('logs')
```

**Retorna:** La configuración de la tabla eliminada.

---

## API — Global

### `init()`

**Debe llamarse una vez al arrancar.** Crea la carpeta de datos si no existe, genera los archivos `.json` de las tablas que no existan todavía, y construye los índices en memoria para las tablas existentes.

```js
const db = new LuneDatabase([...], './data')
await db.init()
```

---

### `backup(destino?)`

Copia todos los archivos `.json` de la carpeta de datos a una subcarpeta con timestamp dentro de `destino`.

```js
const ruta = await db.backup('./backups')
// './backups/backup-2025-06-10T14-32-00-000Z'
```

**Retorna:** `string` con la ruta del backup generado.

---

### `drop({ confirmar })`

Elimina todos los archivos `.json`, vacía la lista de tablas en memoria e intenta borrar la carpeta de datos. Es una operación **irreversible** que requiere confirmación explícita.

```js
await db.drop({ confirmar: true })
```

Sin `{ confirmar: true }` lanza un error de seguridad antes de hacer nada.

---

## Ejemplo completo

```js
import LuneDatabase from './LuneDatabase.js'
import LuneModels   from './LuneModels.js'

// Schema completo de LuneModels definido fuera (Formato C)
const categoriaSchema = LuneModels.schema({
  nombre: LuneModels.string().required().minLength(2),
})

const db = new LuneDatabase([
  {
    nombre: 'categorias',
    id: 'id',
    options: { idAutoIncrementable: true, idUnique: true },
    // Formato C: schema completo de LuneModels
    schema: categoriaSchema,
  },
  {
    nombre: 'productos',
    id: 'id',
    options: {
      idAutoIncrementable: true,
      idUnique: true,
      timestamps: true,
      softDelete: true,
      maxRegistros: 500,
    },
    // Formato B: validadores sueltos de LuneModels
    schema: {
      nombre:      LuneModels.string().required().minLength(2).maxLength(100),
      precio:      LuneModels.number().required().min(0),
      activo:      LuneModels.string(),
      categoriaId: LuneModels.number().required(),
      tags:        LuneModels.array(LuneModels.string()),
    },
    foreignKeys: [
      { nombre: 'categorias', localField: 'categoriaId', foreignField: 'id' }
    ],
    indices: ['categoriaId'],
    hooks: {
      afterAdd: async ({ datos }) => {
        console.log('Producto(s) añadido(s):', datos.map(d => d.nombre))
      },
    },
  },
  {
    nombre: 'logs',
    id: 'id',
    options: { idAutoIncrementable: true, maxRegistros: 10000 },
    // Formato A: schema nativo sin LuneModels
    schema: {
      nivel:   { type: 'string',  required: true },
      mensaje: { type: 'string',  required: true },
      fecha:   { type: 'string',  default: () => new Date().toISOString() },
    },
  },
])

await db.init()

// Datos iniciales
await db.seed('categorias', [
  { nombre: 'Electrónica' },
  { nombre: 'Hogar' },
])

// Insertar
await db.add('productos', { nombre: 'Teclado', precio: 49.99, categoriaId: 1 })
await db.add('productos', { nombre: 'Lámpara',  precio: 29.99, categoriaId: 2 })

// Consultar
const todos   = await db.get('productos')
const caros   = await db.get('productos', p => p.precio > 40)
const primero = await db.find('productos', p => p.nombre === 'Teclado')
const existe  = await db.exists('productos', p => p.categoriaId === 99)
const total   = await db.count('productos')

// Join
const conCategoria = await db.join('productos', 'categorias', 'categoriaId', 'id', 'categoria')
// [{ id: 1, nombre: 'Teclado', ..., categoria: { id: 1, nombre: 'Electrónica' } }]

// Búsqueda por índice
const electronica = await db.findByIndex('productos', 'categoriaId', 1)

// Actualizar (validación parcial: solo valida 'precio')
await db.update('productos', p => p.id === 1, { precio: 44.99 })

// Soft delete
await db.delete('productos', p => p.id === 2)
const eliminados = await db.getDeleted('productos')
await db.restore('productos', p => p.id === 2)

// Logs con schema nativo
await db.add('logs', { nivel: 'info', mensaje: 'Servidor iniciado' })

// Backup
const rutaBackup = await db.backup('./backups')
console.log('Backup en:', rutaBackup)

// Gestión de tablas en caliente
await db.addTable({
  nombre: 'sesiones',
  id: 'id',
  options: { idAutoIncrementable: true, timestamps: true },
  schema: {
    usuarioId: LuneModels.number().required(),
    token:     LuneModels.string().required().minLength(32),
  },
})
await db.updateTable('sesiones', { options: { maxRegistros: 5000 } })
await db.deleteTable('sesiones')

// Destruir todo (cuidado)
// await db.drop({ confirmar: true })
```