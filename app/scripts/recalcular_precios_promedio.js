// scripts/recalcular_precios_promedio.js
// Script de administración para recalcular el precio de venta promedio ponderado de todos los ítems

const admin = require("firebase-admin");

// Si se ejecuta localmente con credenciales de servicio o emulador
if (!admin.apps.length) {
    admin.initializeApp();
}

const db = admin.firestore();

async function recalcularPreciosPromedio() {
    console.log("=== INICIANDO RECÁLCULO DE PRECIOS DE VENTA PROMEDIO ===");
    console.time("Tiempo de ejecución");

    try {
        // 1. Obtener todas las remisiones activas
        console.log("1. Descargando remisiones activas...");
        const remisionesSnap = await db.collection("remisiones")
            .where("estado", "!=", "Anulada")
            .get();

        console.log(`   -> ${remisionesSnap.size} remisiones encontradas.`);

        const statsByItem = {}; // key: itemId o referencia en minúsculas

        remisionesSnap.forEach(docSnap => {
            const rem = docSnap.data();
            const items = Array.isArray(rem.items) ? rem.items : [];
            items.forEach(it => {
                const cantidad = parseInt(it.cantidad) || 0;
                let unitPrice = Number(it.valorPorLamina || it.valorUnitario || 0);
                if (unitPrice <= 0 && it.valorTotal && cantidad > 0) {
                    unitPrice = Number(it.valorTotal) / cantidad;
                }

                if (cantidad > 0 && unitPrice > 0) {
                    const keys = [];
                    if (it.itemId) keys.push(it.itemId);
                    if (it.referencia) keys.push(it.referencia.trim().toLowerCase());

                    keys.forEach(k => {
                        if (!statsByItem[k]) {
                            statsByItem[k] = { totalIngreso: 0, totalCantidad: 0 };
                        }
                        statsByItem[k].totalIngreso += unitPrice * cantidad;
                        statsByItem[k].totalCantidad += cantidad;
                    });
                }
            });
        });

        // 2. Actualizar la colección de ítems
        console.log("2. Actualizando colección 'items' en Firestore...");
        const itemsSnap = await db.collection("items").get();
        console.log(`   -> ${itemsSnap.size} ítems en catálogo.`);

        let batch = db.batch();
        let batchCount = 0;
        let totalUpdated = 0;

        itemsSnap.forEach(itemDoc => {
            const itemData = itemDoc.data();
            const itemId = itemDoc.id;
            const itemRefNorm = (itemData.referencia || '').trim().toLowerCase();

            const stat = statsByItem[itemId] || statsByItem[itemRefNorm];
            let precioPromedioVenta = 0;
            let totalVendidos = 0;

            if (stat && stat.totalCantidad > 0) {
                precioPromedioVenta = Math.round(stat.totalIngreso / stat.totalCantidad);
                totalVendidos = stat.totalCantidad;
            } else if (itemData.precioVenta) {
                precioPromedioVenta = Math.round(Number(itemData.precioVenta));
            }

            batch.update(itemDoc.ref, {
                precioPromedioVenta: precioPromedioVenta,
                totalVendidos: totalVendidos,
                ultimoCalculoPromedio: Date.now(),
                _lastUpdated: admin.firestore.FieldValue.serverTimestamp()
            });

            batchCount++;
            totalUpdated++;

            if (batchCount >= 450) {
                batch.commit();
                batch = db.batch();
                batchCount = 0;
            }
        });

        if (batchCount > 0) {
            await batch.commit();
        }

        console.log(`\n✅ ¡Proceso completado exitosamente!`);
        console.log(`   Total ítems actualizados: ${totalUpdated}`);
        console.timeEnd("Tiempo de ejecución");

    } catch (err) {
        console.error("❌ Error durante el recálculo:", err);
    }
}

if (require.main === module) {
    recalcularPreciosPromedio().then(() => process.exit(0)).catch(() => process.exit(1));
}

module.exports = { recalcularPreciosPromedio };
