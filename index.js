import { readFile, writeFile } from 'fs/promises';

export default class LuneDataBase {
    constructor(path, options = {
        idAutoIncrementable: false,
        idUnique: false
    }) {
        this.path = path;
        this.options = options;
    }

    async get() {
        const rawData = await readFile(this.path, 'utf-8');
        return JSON.parse(rawData);
    }

    async set(nuevosDatos) {
        const datosString = JSON.stringify(nuevosDatos, null, 2);
        await writeFile(this.path, datosString, 'utf-8');
        return datosString;
    }

    async add(nuevosDatos) {
        const datosExistentes = await this.get();
        let datosActualizados;

        const nuevosArray = Array.isArray(nuevosDatos) ? nuevosDatos : [nuevosDatos];

        const nuevosProcesados = nuevosArray.map(nuevo => {
            if (this.options.idAutoIncrementable) {
                if (nuevo.id == null) {
                    const maxId = Array.isArray(datosExistentes) && datosExistentes.length
                        ? Math.max(...datosExistentes.map(d => d.id || 0))
                        : 0;
                    nuevo.id = maxId + 1;
                }
            }

            if (this.options.idUnique && nuevo.id != null) {
                const existe = Array.isArray(datosExistentes) && datosExistentes.some(d => d.id === nuevo.id);
                if (existe) {
                    throw new Error(`El ID ${nuevo.id} ya existe`);
                }
            }

            return nuevo;
        });

        if (Array.isArray(datosExistentes)) {
            datosActualizados = [...datosExistentes, ...nuevosProcesados];
        } else {
            datosActualizados = { ...datosExistentes, ...nuevosProcesados[0] };
        }

        await writeFile(this.path, JSON.stringify(datosActualizados, null, 2), 'utf-8');
        return datosActualizados;
    }
}