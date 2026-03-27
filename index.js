import { readFile, writeFile, mkdir, access } from 'fs/promises';
import { join } from 'path';

export default class LuneDataBase {
    constructor(tablas = [], carpeta = './data') {
        this.carpeta = carpeta;
        this.tablas = tablas.map(t => ({
            ...t,
            path: join(carpeta, `${t.nombre}.json`)
        }));
    }

    async init() {
        await mkdir(this.carpeta, { recursive: true });

        for (const tabla of this.tablas) {
            try {
                await access(tabla.path);
            } catch {
                await writeFile(tabla.path, '[]', 'utf-8');
            }
        }
    }

    async get(tabla, filtro = (e) => true) {
        const tablaArchivo = this.getTabla(tabla)

        if (!tablaArchivo) {
            throw new Error(`Tabla "${tabla}" no encontrada`);
        }

        const rawData = await readFile(tablaArchivo.path, 'utf-8');
        const data = JSON.parse(rawData)
        return data.filter(filtro);
    }

    getTabla(tabla) {
        return this.tablas.find(e => e.nombre == tabla)
    }

    async add(tabla, nuevosDatos) {
        const tablaArchivo = this.getTabla(tabla);

        if (!tablaArchivo) {
            throw new Error(`Tabla "${tabla}" no encontrada`);
        }

        const datosExistentes = await this.get(tabla);
        const nuevosArray = Array.isArray(nuevosDatos) ? nuevosDatos : [nuevosDatos];

        if (tablaArchivo.foreignKeys?.length) {
            for (const fk of tablaArchivo.foreignKeys) {
                const tablaForanea = this.getTabla(fk.nombre);
                if (!tablaForanea) {
                    throw new Error(`Tabla foránea "${fk.nombre}" no encontrada`);
                }

                const datosForaneos = await this.get(fk.nombre);
                const valoresValidos = new Set(datosForaneos.map(d => d[fk.foreignField]));

                for (const nuevo of nuevosArray) {
                    const valorLocal = nuevo[fk.localField];

                    if (valorLocal == null) {
                        if (tablaArchivo.options.foreignKeysRequired) {
                            throw new Error(`El campo "${fk.localField}" es obligatorio en "${tabla}"`);
                        }
                        continue;
                    }

                    if (!valoresValidos.has(valorLocal)) {
                        throw new Error(
                            `Foreign key inválida: "${fk.localField}" con valor "${valorLocal}" no existe en "${fk.nombre}.${fk.foreignField}"`
                        );
                    }
                }
            }
        }

        const nuevosProcesados = nuevosArray.map(nuevo => {
            if (tablaArchivo.options.idAutoIncrementable) {
                if (nuevo.id == null) {
                    const maxId = datosExistentes.length
                        ? Math.max(...datosExistentes.map(d => d[tablaArchivo.id] || 0))
                        : 0;
                    nuevo[tablaArchivo.id] = maxId + 1;
                }
            }

            if (tablaArchivo.options.idUnique && nuevo[tablaArchivo.id] != null) {
                const existe = datosExistentes.some(d => d[tablaArchivo.id] === nuevo[tablaArchivo.id]);
                if (existe) {
                    throw new Error(`El ID ${nuevo[tablaArchivo.id]} ya existe`);
                }
            }

            return nuevo;
        });

        const datosActualizados = [...datosExistentes, ...nuevosProcesados];
        await writeFile(tablaArchivo.path, JSON.stringify(datosActualizados, null, 2), 'utf-8');
        return datosActualizados;
    }

    async update(tabla, filtro, nuevosDatos) {
        const tablaArchivo = this.getTabla(tabla);

        if (!tablaArchivo) {
            throw new Error(`Tabla "${tabla}" no encontrada`);
        }

        const datosExistentes = await this.get(tabla);
        let actualizados = 0;

        if (tablaArchivo.foreignKeys?.length) {
            for (const fk of tablaArchivo.foreignKeys) {
                if (!(fk.localField in nuevosDatos)) continue;

                const tablaForanea = this.getTabla(fk.nombre);
                if (!tablaForanea) {
                    throw new Error(`Tabla foránea "${fk.nombre}" no encontrada`);
                }

                const datosForaneos = await this.get(fk.nombre);
                const valoresValidos = new Set(datosForaneos.map(d => d[fk.foreignField]));
                const valorLocal = nuevosDatos[fk.localField];

                if (valorLocal == null) {
                    if (tablaArchivo.options.foreignKeysRequired) {
                        throw new Error(`El campo "${fk.localField}" es obligatorio en "${tabla}"`);
                    }
                    continue;
                }

                if (!valoresValidos.has(valorLocal)) {
                    throw new Error(
                        `Foreign key inválida: "${fk.localField}" con valor "${valorLocal}" no existe en "${fk.nombre}.${fk.foreignField}"`
                    );
                }
            }
        }

        const datosActualizados = datosExistentes.map(registro => {
            if (!filtro(registro)) return registro;

            if (tablaArchivo.options.idUnique || tablaArchivo.options.idAutoIncrementable) {
                const { [tablaArchivo.id]: _idIgnorado, ...restoNuevosDatos } = nuevosDatos;

                actualizados++;
                return { ...registro, ...restoNuevosDatos };
            }

            actualizados++;
            return { ...registro, ...nuevosDatos };
        });

        if (actualizados === 0) {
            throw new Error(`No se encontraron registros que coincidan con el filtro en "${tabla}"`);
        }

        await writeFile(tablaArchivo.path, JSON.stringify(datosActualizados, null, 2), 'utf-8');
        return datosActualizados;
    }

    async delete(tabla, filtro = () => true) {
        const tablaArchivo = this.getTabla(tabla);

        if (!tablaArchivo) {
            throw new Error(`Tabla "${tabla}" no encontrada`);
        }

        const datosExistentes = await this.get(tabla);
        const datosRestantes = datosExistentes.filter(registro => !filtro(registro));
        const registrosEliminados = datosExistentes.filter(registro => filtro(registro));

        if (registrosEliminados.length === 0) {
            return datosRestantes;
        }

        for (const otraTabla of this.tablas) {
            if (otraTabla.nombre === tabla) continue;
            if (!otraTabla.foreignKeys?.length) continue;

            const fksHaciaEstaTabla = otraTabla.foreignKeys.filter(fk => fk.nombre === tabla);
            if (!fksHaciaEstaTabla.length) continue;

            const datosOtraTabla = await this.get(otraTabla.nombre);

            for (const fk of fksHaciaEstaTabla) {
                const valoresEliminados = new Set(registrosEliminados.map(r => r[fk.foreignField]));

                const tieneReferencias = datosOtraTabla.some(
                    registro => valoresEliminados.has(registro[fk.localField])
                );

                if (tieneReferencias) {
                    throw new Error(
                        `No se puede eliminar: "${otraTabla.nombre}" tiene registros que referencian "${tabla}.${fk.foreignField}"`
                    );
                }
            }
        }

        await writeFile(tablaArchivo.path, JSON.stringify(datosRestantes, null, 2), 'utf-8');
        return datosRestantes;
    }
}
