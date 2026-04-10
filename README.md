# LuneDatabase

LuneDatabase es una base de datos ligera basada en archivos JSON, diseñada para Node.js. Permite gestionar tablas, relaciones, índices, validaciones, hooks y más, sin necesidad de un motor de base de datos externo.

---

## Instalación

No requiere instalación desde npm. Solo importa la clase en tu proyecto:

```js
import LuneDatabase from './LuneDatabase.js'
```

---

## Uso básico

```js
const db = new LuneDatabase([
  {
    name: 'users',
    id: 'id',
    options: {
      idAutoIncrementable: true,
      idUnique: true,
      timestamps: true
    }
  }
], {
  path: './data'
})

await db.init()
```

---

## Configuración de tablas

Cada tabla puede tener:

```js
{
  name: 'users',
  id: 'id',
  schema: {
    validate: (data) => ({ valid: true, value: data, errors: {} })
  },
  indices: ['email'],
  foreignKeys: [
    {
      tableName: 'roles',
      localField: 'roleId',
      foreignField: 'id'
    }
  ],
  hooks: {
    beforeAdd: async (ctx) => {},
    afterAdd: async (ctx) => {}
  },
  options: {
    readonly: false,
    timestamps: true,
    softDelete: true,
    idAutoIncrementable: true,
    idUnique: true,
    foreignKeysRequired: false
  }
}
```

---

## Inicialización

```js
await db.init()
```

Crea los archivos si no existen y construye índices.

---

## Métodos principales

### Obtener datos

```js
await db.get('users', u => u.age > 18)
await db.find('users', u => u.id === 1)
await db.exists('users', u => u.email === 'test@mail.com')
await db.count('users')
```

---

### Insertar datos

```js
await db.add('users', { name: 'Juan' })
await db.add('users', [
  { name: 'Ana' },
  { name: 'Luis' }
])
```

---

### Actualizar datos

```js
await db.update('users', u => u.id === 1, { name: 'Pedro' })
await db.updateAll('users', { active: true })
```

---

### Eliminar datos

```js
await db.delete('users', u => u.id === 1)
await db.clear('users')
```

Soporta **soft delete** si está habilitado:

```js
await db.getDeleted('users')
await db.restore('users', u => u.id === 1)
```

---

### Relaciones (Join)

```js
await db.join('users', 'roles', 'roleId')
```

---

### Índices

```js
await db.findByIndex('users', 'email', 'test@mail.com')
```

---

### Seed

```js
await db.seed('users', [
  { name: 'Admin' }
])
```

Solo inserta si la tabla está vacía.

---

### Backup

```js
await db.backup('./backups')
```

---

### Tablas dinámicas

```js
await db.createTable({ name: 'posts', id: 'id' })
await db.updateTable('posts', { indices: ['title'] })
await db.deleteTable('posts')
```

---

### Guardado manual (modo memoria)

```js
await db.save()
```

---

## Modo en memoria

```js
const db = new LuneDatabase([...], {
  inMemory: true
})
```

No escribe automáticamente en disco hasta usar `save()`.

---

## Hooks disponibles

* beforeAdd
* afterAdd
* beforeUpdate
* afterUpdate
* beforeDelete
* afterDelete

Ejemplo:

```js
hooks: {
  beforeAdd: async ({ table, datos }) => {
    console.log('Insertando en', table)
  }
}
```

---

## Validación de esquema

El schema debe implementar:

```js
{
  validate(data) {
    return {
      valid: true,
      value: data,
      errors: {}
    }
  }
}
```

---

## Foreign Keys

Se validan automáticamente en inserciones y actualizaciones.

Opciones:

* `foreignKeysRequired`: obliga a que no sean null

---

## Opciones globales

```js
{
  path: './data',
  inMemory: false
}
```

---

## Seguridad

* Previene eliminación si hay referencias (foreign keys)
* Control de tablas readonly
* Validación de IDs únicos

---

## Eliminación total

```js
await db.drop({ confirmar: true })
```

Elimina todos los archivos y tablas.

---

## Notas

* Basado en archivos JSON
* No es adecuado para alta concurrencia
* Ideal para prototipos, herramientas internas o proyectos pequeños
