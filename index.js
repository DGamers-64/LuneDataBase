import { readFile, writeFile } from 'fs/promises';

export default class LuneDataBase {
    constructor(path) {
        this.path = path;
    }

    async get() {
        const rawData = await readFile(this.path, 'utf-8');
        const datos = JSON.parse(rawData);
        return datos;
    }

    async set(nuevosDatos) {
        const datosString = JSON.stringify(nuevosDatos, null, 2);
        await writeFile(this.path, datosString, 'utf-8');
        return datosString;
    }

    async add(nuevosDatos) {
        const datosExistentes = await this.get();

        let datosActualizados;
        if (Array.isArray(datosExistentes)) {
            if (Array.isArray(nuevosDatos)) {
                datosActualizados = [...datosExistentes, ...nuevosDatos];
            } else {
                datosActualizados = [...datosExistentes, nuevosDatos];
            }
        } else {
            datosActualizados = { ...datosExistentes, ...nuevosDatos };
        }

        await writeFile(this.path, JSON.stringify(datosActualizados, null, 2), 'utf-8');
        return datosActualizados;
    }
}