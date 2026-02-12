require('dotenv').config();

const functions = require("firebase-functions");
const cors = require("cors")({ origin: true });
const admin = require("firebase-admin");
const sgMail = require("@sendgrid/mail");
const { jsPDF } = require("jspdf");
require("jspdf-autotable");
const axios = require("axios");

// Importamos webhook una sola vez
const waWebhook = require("./webhook"); // <--- LIMPIEZA: Importación única

admin.initializeApp();

// --- CONFIGURACIÓN CON VARIABLES DE ENTORNO (.ENV) ---

// Configurar SendGrid
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
const FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL;

if (SENDGRID_API_KEY) {
    const cleanKey = SENDGRID_API_KEY.replace(/['"\s]/g, '');
    try {
        sgMail.setApiKey(cleanKey);
    } catch (error) {
        console.error("Error configurando API Key de SendGrid:", error.message);
    }
} else {
    console.warn("ADVERTENCIA: No se encontró SENDGRID_API_KEY en el archivo .env");
}

// Configuración de WhatsApp
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN?.replace(/['"\s]/g, '');

// CORREGIDO: El nombre de la variable debe coincidir con su uso más abajo
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID?.replace(/['"\s]/g, ''); 

const BUCKET_NAME = "prismacolorsas.firebasestorage.app";


// ==========================================
//              FUNCIONES ÚTILES
// ==========================================

function formatCurrency(value) {
    return new Intl.NumberFormat("es-CO", {
        style: "currency",
        currency: "COP",
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    }).format(value || 0);
}

function formatColombianPhone(phone) {
    if (!phone || typeof phone !== "string") {
        return null;
    }
    let cleanPhone = phone.replace(/[\s-()]/g, "");
    if (cleanPhone.startsWith("57")) {
        return cleanPhone;
    }
    if (cleanPhone.length === 10) {
        return `57${cleanPhone}`;
    }
    return null;
}

/**
 * Envía un mensaje de plantilla de WhatsApp con un documento.
 */
async function sendWhatsAppRemision(toPhoneNumber, customerName, remisionNumber, status, pdfUrl) {
    // Verificación de seguridad
    if (!WHATSAPP_PHONE_NUMBER_ID) {
        throw new Error("ERROR CRÍTICO: WHATSAPP_PHONE_NUMBER_ID no está definido. Revisa tu .env");
    }

    const formattedPhone = formatColombianPhone(toPhoneNumber);
    if (!formattedPhone) {
        throw new Error("Número de teléfono inválido o no proporcionado.");
    }

    const API_VERSION = "v19.0";
    // AHORA SÍ: La variable existe
    const url = `https://graph.facebook.com/${API_VERSION}/${WHATSAPP_PHONE_NUMBER_ID}/messages`;

    const payload = {
        messaging_product: "whatsapp",
        to: formattedPhone,
        type: "template",
        template: {
            name: "envio_remision",
            language: { code: "es" },
            components: [
                {
                    type: "header",
                    parameters: [
                        {
                            type: "document",
                            document: {
                                link: pdfUrl,
                                filename: `Remision-${remisionNumber}.pdf`,
                            },
                        },
                    ],
                },
                {
                    type: "body",
                    parameters: [
                        { type: "text", text: customerName },
                        { type: "text", text: remisionNumber },
                        { type: "text", text: status },
                    ],
                },
            ],
        },
    };

    const headers = {
        "Authorization": `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
    };

    return axios.post(url, payload, { headers });
}

// ... (El código de generarPDF se mantiene igual, lo omito para ahorrar espacio) ...
function generarPDF(remisionData, esPlanta) {
    const remision = remisionData;
    const isForPlanta = esPlanta;
    const doc = new jsPDF();

    doc.setFontSize(20);
    doc.setFont("helvetica", "bold");
    doc.text("REMISION DE SERVICIO", 105, 20, { align: "center" });

    if (remision.estado === "Anulada") {
        doc.setFontSize(60);
        doc.setTextColor(255, 0, 0);
        doc.text("ANULADA", 105, 140, null, 45);
        doc.setTextColor(0, 0, 0);
    }

    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text("PRISMACOLOR", 105, 28, { align: "center" });
    doc.setFont("helvetica", "normal");
    const contactInfo = "Tels: 310 2557543 – 313 2522810";
    const address = "Cra 27A No. 68-80";
    doc.text(contactInfo, 105, 33, { align: "center" });
    doc.text(address, 105, 38, { align: "center" });

    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    const remisionNum = `Remisión N°: ${remision.numeroRemision}`;
    doc.text(remisionNum, 190, 45, { align: "right" });

    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text("Cliente:", 20, 55);
    doc.setFont("helvetica", "normal");
    doc.text(remision.clienteNombre, 40, 55);
    if (!isForPlanta) {
        doc.setFont("helvetica", "bold");
        doc.text("Correo:", 20, 61);
        doc.setFont("helvetica", "normal");
        doc.text(remision.clienteEmail, 40, 61);
    }

    doc.setFont("helvetica", "bold");
    doc.text("Fecha Recibido:", 130, 55);
    doc.setFont("helvetica", "normal");
    doc.text(remision.fechaRecibido, 165, 55);

    doc.setFont("helvetica", "bold");
    doc.text("Fecha Entrega:", 130, 61);
    doc.setFont("helvetica", "normal");
    doc.text(remision.fechaEntrega || "Pendiente", 165, 61);

    let tableColumn = ["Referencia", "Descripción", "Color", "Cant."];
    if (!isForPlanta) {
        tableColumn.push("Vlr. Unit.", "Subtotal");
    }

    const tableRows = remision.items.map((item) => {
        const row = [item.referencia, item.descripcion, item.color, item.cantidad];
        if (!isForPlanta) {
            row.push(formatCurrency(item.valorUnitario), formatCurrency(item.cantidad * item.valorUnitario));
        }
        return row;
    });

    doc.autoTable({
        head: [tableColumn],
        body: tableRows,
        startY: 75,
        theme: "grid",
        headStyles: { fillColor: [22, 160, 133] },
    });

    const finalY = doc.lastAutoTable.finalY;
    let yPos = finalY + 10;

    if (remision.observaciones && remision.observaciones.trim() !== "") {
        doc.setFontSize(10);
        doc.setFont("helvetica", "bold");
        doc.text("Observaciones:", 20, yPos);
        doc.setFont("helvetica", "normal");
        const textoObservaciones = doc.splitTextToSize(remision.observaciones, 170);
        doc.text(textoObservaciones, 20, yPos + 5);
        yPos += (textoObservaciones.length * 5) + 5;
    }

    if (!isForPlanta) {
        doc.setFontSize(12);
        doc.setFont("helvetica", "bold");
        doc.text("Subtotal:", 130, yPos);
        doc.setFont("helvetica", "normal");
        doc.text(formatCurrency(remision.subtotal), 190, yPos, { align: "right" });
        yPos += 7;

        if (remision.discount && remision.discount.amount > 0) {
            doc.setFont("helvetica", "bold");
            doc.text("Descuento:", 130, yPos);
            doc.setFont("helvetica", "normal");
            doc.text(`-${formatCurrency(remision.discount.amount)}`, 190, yPos, { align: "right" });
            yPos += 7;
        }

        if (remision.incluyeIVA) {
            doc.setFont("helvetica", "bold");
            doc.text("IVA (19%):", 130, yPos);
            doc.setFont("helvetica", "normal");
            doc.text(formatCurrency(remision.valorIVA), 190, yPos, { align: "right" });
            yPos += 7;
        }

        doc.setFont("helvetica", "bold");
        doc.text("TOTAL:", 130, yPos);
        doc.text(formatCurrency(remision.valorTotal), 190, yPos, { align: "right" });
        yPos += 11;

        doc.setFontSize(10);
        doc.text(`Forma de Pago: ${remision.formaPago}`, 20, yPos);
        yPos += 7;
        doc.text(`Estado: ${remision.estado}`, 20, yPos);
    }

    yPos = Math.max(yPos, finalY + 20);
    yPos = 250;
    doc.line(40, yPos, 120, yPos);
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text("Firma y Sello de Recibido", 75, yPos + 5, { align: "center" });

    doc.setLineCap(2);
    doc.line(20, 270, 190, 270);
    const footerText1 = "NO SE ENTREGA TRABAJO SINO HA SIDO CANCELADO.";
    const footerText2 = "DESPUES DE 8 DIAS NO SE RESPONDE POR MERCANCIA.";
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.text(footerText1, 105, 275, { align: "center" });
    doc.text(footerText2, 105, 279, { align: "center" });

    return Buffer.from(doc.output("arraybuffer"));
}

// ==========================================
//              TRIGGERS DE FIRESTORE
// ==========================================

exports.onUserCreate = functions.auth.user().onCreate(async (user) => {
    const usersCollection = admin.firestore().collection("users");
    const snapshot = await usersCollection.limit(2).get();
    if (snapshot.size === 1) {
        return usersCollection.doc(user.uid).update({
            role: "admin",
            status: "active",
            "permissions.facturacion": true,
            "permissions.clientes": true,
            "permissions.items": true,
            "permissions.colores": true,
            "permissions.gastos": true,
            "permissions.proveedores": true,
            "permissions.empleados": true,
        });
    }
    return null;
});

exports.onRemisionCreate = functions.region("us-central1").firestore
    .document("remisiones/{remisionId}")
    .onCreate(async (snap, context) => {
        const remisionData = snap.data();
        const remisionId = context.params.remisionId;
        const log = (message) => functions.logger.log(`[${remisionId}] ${message}`);

        let emailStatus = "pending";
        let whatsappStatus = "pending";

        try {
            const pdfBuffer = generarPDF(remisionData, false);
            const pdfPlantaBuffer = generarPDF(remisionData, true);

            const bucket = admin.storage().bucket(BUCKET_NAME);

            const filePath = `remisiones/${remisionData.numeroRemision}.pdf`;
            const file = bucket.file(filePath);
            await file.save(pdfBuffer, { metadata: { contentType: "application/pdf" } });

            const filePathPlanta = `remisiones/planta-${remisionData.numeroRemision}.pdf`;
            const filePlanta = bucket.file(filePathPlanta);
            await filePlanta.save(pdfPlantaBuffer, { metadata: { contentType: "application/pdf" } });

            await snap.ref.update({
                pdfPath: filePath,
                pdfPlantaPath: filePathPlanta
            });

            const [url] = await file.getSignedUrl({
                action: "read",
                expires: Date.now() + 7 * 24 * 60 * 60 * 1000,
                version: 'v4'
            });

            // Enviar Correo Cliente
            try {
                const msg = {
                    to: remisionData.clienteEmail,
                    from: FROM_EMAIL,
                    subject: `Confirmación de Remisión N° ${remisionData.numeroRemision}`,
                    html: `<p>Hola ${remisionData.clienteNombre},</p><p>Hemos recibido tu orden y adjuntamos la remisión de servicio.</p><p>El estado actual es: <strong>${remisionData.estado}</strong>.</p><p>Gracias por confiar en nosotros.</p><p><strong>Prismacolor S.A.S.</strong></p>`,
                    attachments: [{
                        content: pdfBuffer.toString("base64"),
                        filename: `Remision-${remisionData.numeroRemision}.pdf`,
                        type: "application/pdf",
                        disposition: "attachment",
                    }],
                };
                await sgMail.send(msg);
                emailStatus = "sent";
            } catch (emailError) {
                log("Error correo cliente: " + emailError.message);
                emailStatus = "error";
            }

            // Enviar a Impresora
            try {
                const printerMsg = {
                    to: "oficinavidriosexito@print.brother.com",
                    from: FROM_EMAIL,
                    subject: `Nueva Remisión N° ${remisionData.numeroRemision} para Imprimir`,
                    html: `<p>Se ha generado la remisión N° ${remisionData.numeroRemision}. Adjunto para impresión.</p>`,
                    attachments: [{
                        content: pdfBuffer.toString("base64"),
                        filename: `Remision-${remisionData.numeroRemision}.pdf`,
                        type: "application/pdf",
                        disposition: "attachment",
                    }],
                };
                await sgMail.send(printerMsg);
                log(`Copia impresora enviada.`);
            } catch (printerError) {
                log("Error impresora: " + printerError.message);
            }

            // Enviar WhatsApp
            try {
                const clienteDoc = await admin.firestore().collection("clientes").doc(remisionData.idCliente).get();
                if (clienteDoc.exists) {
                    const clienteData = clienteDoc.data();
                    const telefonos = [...new Set([clienteData.telefono1, clienteData.telefono2].filter(Boolean))];

                    if (telefonos.length > 0) {
                        for (const telefono of telefonos) {
                            try {
                                await sendWhatsAppRemision(
                                    telefono,
                                    remisionData.clienteNombre,
                                    remisionData.numeroRemision.toString(),
                                    remisionData.estado,
                                    url
                                );
                            } catch (whatsappError) {
                                functions.logger.error(`Error WhatsApp ${telefono}:`, whatsappError.response ? whatsappError.response.data : whatsappError.message);
                            }
                        }
                        whatsappStatus = "sent";
                    } else {
                        whatsappStatus = "no_phone";
                    }
                }
            } catch (whatsappError) {
                functions.logger.error(`Error proceso WhatsApp:`, whatsappError);
                whatsappStatus = "error";
            }

            return snap.ref.update({
                emailStatus: emailStatus,
                whatsappStatus: whatsappStatus,
            });

        } catch (error) {
            functions.logger.error(`[${remisionId}] Error General Create:`, error);
            return snap.ref.update({ emailStatus: "error", whatsappStatus: "error" });
        }
    });

/**
 * Trigger al ACTUALIZAR Remisión: 
 * 1. Detecta cambios de estado (Anulada/Entregado) y notifica.
 * 2. Detecta pagos totales para notificar cancelación.
 * 3. Actualiza automáticamente 'saldoPendiente' y 'formaPago'.
 */
exports.onRemisionUpdate = functions.region("us-central1").firestore
    .document("remisiones/{remisionId}")
    .onUpdate(async (change, context) => {
        const beforeData = change.before.data();
        const afterData = change.after.data();
        const remisionId = context.params.remisionId;
        const log = (message) => functions.logger.log(`[Upd ${remisionId}] ${message}`);

        // --- 1. LÓGICA DE NOTIFICACIONES (CORREO / WHATSAPP / PDF) ---

        const sendNotifications = async (motivo, pdfUrlToSend, pdfBuffer) => {
            // Correo
            try {
                let subject = '', htmlBody = '';
                if (motivo === 'Anulación') {
                    subject = `Anulación de Remisión N° ${afterData.numeroRemision}`;
                    htmlBody = `<p>Hola ${afterData.clienteNombre},</p><p>Te informamos que la remisión N° <strong>${afterData.numeroRemision}</strong> ha sido anulada.</p><p>Adjuntamos copia.</p>`;
                } else if (motivo === 'Entrega') {
                    subject = `Tu orden N° ${afterData.numeroRemision} ha sido entregada`;
                    htmlBody = `<p>Hola ${afterData.clienteNombre},</p><p>Tu orden N° <strong>${afterData.numeroRemision}</strong> ha sido marcada como <strong>entregada</strong>.</p><p>Adjuntamos remisión final.</p>`;
                }

                const msg = {
                    to: afterData.clienteEmail,
                    from: FROM_EMAIL,
                    subject: subject,
                    html: htmlBody,
                    attachments: [{
                        content: pdfBuffer.toString("base64"),
                        filename: `Remision-${motivo}-${afterData.numeroRemision}.pdf`,
                        type: "application/pdf",
                        disposition: "attachment",
                    }],
                };
                await sgMail.send(msg);
            } catch (error) { log(`Error correo ${motivo}: ${error.message}`); }

            // WhatsApp
            try {
                const clienteDoc = await admin.firestore().collection("clientes").doc(afterData.idCliente).get();
                if (clienteDoc.exists) {
                    const cData = clienteDoc.data();
                    const telefonos = [cData.telefono1, cData.telefono2].filter(Boolean);
                    for (const tel of telefonos) {
                        await sendWhatsAppRemision(tel, afterData.clienteNombre, afterData.numeroRemision.toString(), afterData.estado, pdfUrlToSend);
                    }
                }
            } catch (error) { log(`Error WhatsApp ${motivo}: ${error.message}`); }
        };

        const regeneratePdfs = async (rData) => {
            const pdfBuffer = generarPDF(rData, false);
            const pdfPlantaBuffer = generarPDF(rData, true);
            const bucket = admin.storage().bucket(BUCKET_NAME);

            const file = bucket.file(rData.pdfPath);
            await file.save(pdfBuffer, { metadata: { contentType: "application/pdf" } });

            const filePlanta = bucket.file(rData.pdfPlantaPath);
            await filePlanta.save(pdfPlantaBuffer, { metadata: { contentType: "application/pdf" } });

            const [url] = await file.getSignedUrl({ action: "read", expires: Date.now() + 7 * 24 * 60 * 60 * 1000, version: 'v4' });
            return { pdfUrl: url, pdfBuffer: pdfBuffer };
        };

        // A. Cambio de Estado (Anulada / Entregado)
        if ((beforeData.estado !== "Anulada" && afterData.estado === "Anulada") || (beforeData.estado !== "Entregado" && afterData.estado === "Entregado")) {
            const motivo = afterData.estado === "Anulada" ? "Anulación" : "Entrega";
            try {
                const { pdfUrl, pdfBuffer } = await regeneratePdfs(afterData);
                await sendNotifications(motivo, pdfUrl, pdfBuffer);
            } catch (e) { log(`Error procesando ${motivo}: ${e}`); }
        }

        // B. Pago Final Detectado (Notificación)
        const totalPagadoAntes = (beforeData.payments || []).filter((p) => p.status === "confirmado").reduce((sum, p) => sum + p.amount, 0);
        const totalPagadoDespues = (afterData.payments || []).filter((p) => p.status === "confirmado").reduce((sum, p) => sum + p.amount, 0);

        if (totalPagadoAntes < afterData.valorTotal && totalPagadoDespues >= afterData.valorTotal) {
            log("Pago final detectado (Notificación).");
            try {
                // Generamos PDF actualizado
                const updatedData = { ...afterData, formaPago: "Cancelado" }; // Simulamos el dato para el PDF
                const { pdfBuffer } = await regeneratePdfs(updatedData);

                const msg = {
                    to: afterData.clienteEmail,
                    from: FROM_EMAIL,
                    subject: `Pago Total Confirmado - Remisión N° ${afterData.numeroRemision}`,
                    html: `<p>Hola ${afterData.clienteNombre},</p><p>Hemos recibido el pago final. Remisión cancelada.</p>`,
                    attachments: [{
                        content: pdfBuffer.toString("base64"),
                        filename: `Remision-CANCELADA-${afterData.numeroRemision}.pdf`,
                        type: "application/pdf",
                        disposition: "attachment",
                    }],
                };
                await sgMail.send(msg);
            } catch (e) { log(`Error notif pago final: ${e}`); }
        }

        // --- 2. LÓGICA DE SALDO PENDIENTE (AUTOMATIZACIÓN) ---
        // Esta parte actualiza la DB para que el filtro de cartera funcione eficientemente

        let nuevoSaldo = afterData.valorTotal - totalPagadoDespues;
        if (nuevoSaldo < 0) nuevoSaldo = 0; // Evitar negativos
        if (afterData.estado === 'Anulada') nuevoSaldo = 0; // Anulada no debe nada

        // Verificamos si cambió el saldo o la forma de pago para actualizar la DB
        // Usamos una tolerancia de 1 peso para decimales
        const saldoAnterior = afterData.saldoPendiente;
        const formaPagoActual = afterData.formaPago;
        
        let nuevaFormaPago = formaPagoActual;
        
        // Calcular la nueva forma de pago correcta basada en el saldo
        if (nuevoSaldo <= 0) {
            nuevaFormaPago = "Cancelado";
        } else if (formaPagoActual === "Cancelado" && nuevoSaldo > 0) {
            // Si estaba cancelado pero ahora debe (ej: anularon un pago), vuelve a pendiente
            nuevaFormaPago = "Pendiente";
        }

        // Solo escribimos en Firestore si hay cambios reales para evitar bucles infinitos
        // Comparación segura para saldoAnterior (undefined check)
        const saldoCambio = saldoAnterior === undefined || Math.abs(nuevoSaldo - saldoAnterior) > 1;
        const formaPagoCambio = nuevaFormaPago !== formaPagoActual;

        if (saldoCambio || formaPagoCambio) {
            log(`Actualizando saldo: ${nuevoSaldo} (Antes: ${saldoAnterior}) | Estado: ${nuevaFormaPago}`);
            return change.after.ref.update({
                saldoPendiente: nuevoSaldo,
                formaPago: nuevaFormaPago
            });
        }

        return null;
    });

/**
 * Callable: MIGRACIÓN DE CARTERA
 * Recorre todas las remisiones y les calcula el 'saldoPendiente'.
 */
exports.migrarSaldosCartera = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Auth requerida");

    const batchSize = 500;
    const collectionRef = admin.firestore().collection("remisiones");
    const snapshot = await collectionRef.get(); // Leemos todo una última vez
    
    let batch = admin.firestore().batch();
    let count = 0;
    let totalUpdated = 0;

    snapshot.docs.forEach((doc) => {
        const r = doc.data();
        
        // Calcular saldo
        const pagado = (r.payments || [])
            .filter(p => p.status === 'confirmado')
            .reduce((sum, p) => sum + p.amount, 0);
        
        let saldo = (r.valorTotal || 0) - pagado;
        if (saldo < 0) saldo = 0;
        if (r.estado === 'Anulada') saldo = 0;

        // Solo actualizamos si no tiene el campo o está mal
        if (r.saldoPendiente === undefined || Math.abs(r.saldoPendiente - saldo) > 1) {
            batch.update(doc.ref, { saldoPendiente: saldo });
            count++;
            totalUpdated++;
        }

        if (count >= batchSize) {
            batch.commit();
            batch = admin.firestore().batch();
            count = 0;
        }
    });

    if (count > 0) await batch.commit();

    return { success: true, actualizados: totalUpdated };
});

// ... (onResendEmailRequest, getFirebaseConfig, applyDiscount, updateEmployeeDocument, etc... SE MANTIENEN IGUAL) ...
exports.onResendEmailRequest = functions.region("us-central1").firestore
    .document("resendQueue/{queueId}")
    .onCreate(async (snap, context) => {
        const request = snap.data();
        try {
            const remisionDoc = await admin.firestore().collection("remisiones").doc(request.remisionId).get();
            if (!remisionDoc.exists) return snap.ref.delete();
            const rData = remisionDoc.data();
            const bucket = admin.storage().bucket(BUCKET_NAME);
            const [pdfBuffer] = await bucket.file(rData.pdfPath).download();
            const msg = {
                to: rData.clienteEmail,
                from: FROM_EMAIL,
                subject: `[Reenvío] Remisión N° ${rData.numeroRemision}`,
                html: `<p>Hola ${rData.clienteNombre},</p><p>Aquí tienes la copia solicitada.</p>`,
                attachments: [{
                    content: pdfBuffer.toString("base64"),
                    filename: `Remision-${rData.numeroRemision}.pdf`,
                    type: "application/pdf",
                    disposition: "attachment",
                }],
            };
            await sgMail.send(msg);
            return snap.ref.delete();
        } catch (error) {
            return snap.ref.update({ status: "error", error: error.message });
        }
    });

exports.getFirebaseConfig = functions.https.onCall((data, context) => {
    if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Auth requerida.");
    const config = {
        apiKey: process.env.PRISMA_API_KEY,
        authDomain: process.env.PRISMA_AUTH_DOMAIN,
        projectId: process.env.PRISMA_PROJECT_ID,
        storageBucket: process.env.PRISMA_STORAGE_BUCKET,
        messagingSenderId: process.env.PRISMA_MESSAGING_SENDER_ID,
        appId: process.env.PRISMA_APP_ID,
        measurementId: process.env.PRISMA_MEASUREMENT_ID
    };
    if (!config.apiKey) throw new functions.https.HttpsError("internal", "Configuración de servidor incompleta.");
    return config;
});

exports.applyDiscount = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Auth requerida.");
    const { remisionId, discountPercentage } = data;
    if (discountPercentage < 0 || discountPercentage > 5.0001) throw new functions.https.HttpsError("out-of-range", "Descuento máximo 5%.");
    const remisionRef = admin.firestore().collection("remisiones").doc(remisionId);
    try {
        const remSnap = await remisionRef.get();
        if (!remSnap.exists) throw new functions.https.HttpsError("not-found", "No existe la remisión.");
        const rData = remSnap.data();
        const discountAmount = Math.round(rData.subtotal * (discountPercentage / 100));
        const subWithDisc = rData.subtotal - discountAmount;
        const newIva = rData.incluyeIVA ? Math.round(subWithDisc * 0.19) : 0;
        const newTotal = subWithDisc + newIva;
        const updatedData = {
            valorTotal: newTotal,
            valorIVA: newIva,
            discount: {
                percentage: discountPercentage,
                amount: discountAmount,
                appliedBy: context.auth.uid,
                appliedAt: new Date(),
            },
        };
        await remisionRef.update(updatedData);
        const finalData = { ...rData, ...updatedData };
        const pdfBuffer = generarPDF(finalData, false);
        const pdfPlantaBuffer = generarPDF(finalData, true);
        const bucket = admin.storage().bucket(BUCKET_NAME);
        const file = bucket.file(`remisiones/${finalData.numeroRemision}.pdf`);
        await file.save(pdfBuffer, { metadata: { contentType: "application/pdf" } });
        const filePlanta = bucket.file(`remisiones/planta-${finalData.numeroRemision}.pdf`);
        await filePlanta.save(pdfPlantaBuffer, { metadata: { contentType: "application/pdf" } });
        const [url] = await file.getSignedUrl({ action: "read", expires: "03-09-2491", version: 'v4' });
        const [urlPlanta] = await filePlanta.getSignedUrl({ action: "read", expires: "03-09-2491", version: 'v4' });
        await remisionRef.update({ pdfUrl: url, pdfPlantaUrl: urlPlanta });
        const msg = {
            to: finalData.clienteEmail,
            from: FROM_EMAIL,
            subject: `Descuento aplicado - Remisión N° ${finalData.numeroRemision}`,
            html: `<p>Hola ${finalData.clienteNombre},</p><p>Nuevo total: <strong>${formatCurrency(newTotal)}</strong> (Desc: ${discountPercentage}%).</p>`,
            attachments: [{
                content: pdfBuffer.toString("base64"),
                filename: `Remision-Actualizada-${finalData.numeroRemision}.pdf`,
                type: "application/pdf",
                disposition: "attachment",
            }],
        };
        await sgMail.send(msg);
        return { success: true };
    } catch (e) {
        throw new functions.https.HttpsError("internal", e.message);
    }
});

exports.updateEmployeeDocument = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Auth requerida.");
    const adminUser = await admin.firestore().collection("users").doc(context.auth.uid).get();
    if (adminUser.data().role !== "admin") throw new functions.https.HttpsError("permission-denied", "Solo admin.");
    const { employeeId, docType, fileUrl } = data;
    await admin.firestore().collection("users").doc(employeeId).update({
        [`documentos.${docType}`]: fileUrl
    });
    return { success: true };
});

exports.getSignedUrlForPath = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Auth requerida.");
    const bucket = admin.storage().bucket(BUCKET_NAME);
    const [signedUrl] = await bucket.file(data.path).getSignedUrl({
        action: 'read',
        expires: Date.now() + 15 * 60 * 1000,
        version: 'v4',
    });
    return { url: signedUrl };
});

exports.repairSignedUrls = functions.https.onCall(async (data, context) => {
    const uid = context.auth?.uid;
    if (!uid) throw new functions.https.HttpsError("unauthenticated", "Auth requerida.");
    const userSnap = await admin.firestore().collection("users").doc(uid).get();
    if (userSnap.data().role !== "admin") throw new functions.https.HttpsError("permission-denied", "Solo admin.");
    const { fromDate = "2025-08-14", onlyBroken = true } = data;
    const from = new Date(fromDate);
    const bucket = admin.storage().bucket(BUCKET_NAME);
    const remSnap = await admin.firestore().collection("remisiones")
        .where("timestamp", ">=", from).get();
    let fixed = 0, skipped = 0, errors = 0;
    for (const doc of remSnap.docs) {
        const r = doc.data();
        try {
            if (onlyBroken && typeof r.pdfUrl === "string") {
                try {
                    const u = new URL(r.pdfUrl);
                    if (u.hostname === "storage.googleapis.com") {
                        skipped++; continue;
                    }
                } catch (_) { }
            }
            const [url] = await bucket.file(`remisiones/${r.numeroRemision}.pdf`)
                .getSignedUrl({ action: "read", expires: "03-09-2491", version: 'v4' });
            const [urlPlanta] = await bucket.file(`remisiones/planta-${r.numeroRemision}.pdf`)
                .getSignedUrl({ action: "read", expires: "03-09-2491", version: 'v4' });
            await doc.ref.update({ pdfUrl: url, pdfPlantaUrl: urlPlanta });
            fixed++;
        } catch (e) {
            errors++;
            console.error(`Error reparando ${r.numeroRemision}:`, e.message);
        }
    }
    return { fixed, skipped, errors, total: remSnap.size };
});

exports.applyRetention = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Auth requerida.");
    const { remisionId, amount } = data;
    if (!remisionId || !amount || amount <= 0) {
        throw new functions.https.HttpsError("invalid-argument", "Datos inválidos.");
    }
    const db = admin.firestore();
    const remRef = db.collection("remisiones").doc(remisionId);
    try {
        await db.runTransaction(async (t) => {
            const doc = await t.get(remRef);
            if (!doc.exists) throw "No existe la remisión";
            const rData = doc.data();
            const totalPagado = (rData.payments || [])
                .filter(p => p.status === 'confirmado')
                .reduce((sum, p) => sum + p.amount, 0);
            const saldo = rData.valorTotal - totalPagado;
            if (amount > saldo) throw new functions.https.HttpsError("failed-precondition", "La retención excede el saldo.");
            const retentionPayment = {
                amount: amount,
                date: new Date().toISOString().split('T')[0],
                method: "Retención",
                registeredAt: new Date(),
                registeredBy: context.auth.uid,
                status: 'confirmado',
                isRetention: true
            };
            const newPayments = [...(rData.payments || []), retentionPayment];
            t.update(remRef, { payments: newPayments });
        });
        return { success: true };
    } catch (error) {
        throw new functions.https.HttpsError("internal", error.message || "Error interno.");
    }
});

// ==========================================
//      AGREGACIÓN AUTOMÁTICA (DASHBOARD)
// ==========================================

/**
 * Helper para actualizar estadísticas mensuales
 */
async function updateMonthlyStats(dateStr, changeSales, changeIncome, changeExpenses) {
    if (!dateStr) return;
    const date = new Date(dateStr);
    // ID del documento será "YYYY_MM" (ej: 2024_05)
    const docId = `${date.getFullYear()}_${(date.getMonth() + 1).toString().padStart(2, '0')}`;
    const statsRef = admin.firestore().collection("estadisticas_mensuales").doc(docId);

    await statsRef.set({
        totalVentas: admin.firestore.FieldValue.increment(changeSales),
        totalIngresos: admin.firestore.FieldValue.increment(changeIncome), // Pagos recibidos
        totalGastos: admin.firestore.FieldValue.increment(changeExpenses),
        ultimaActualizacion: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
}

/**
 * Trigger: Escucha cambios en REMISIONES
 * CORREGIDO: "Ventas" ahora es el valor total de la remisión (independiente de si pagan).
 * "Ingresos" es lo que realmente entra a caja (pagos).
 */
exports.aggregateRemisiones = functions.firestore
    .document("remisiones/{remisionId}")
    .onWrite(async (change, context) => {
        const before = change.before.exists ? change.before.data() : {};
        const after = change.after.exists ? change.after.data() : {};

        // 1. Calcular Venta (Valor Total si no está anulada)
        const ventaBefore = (before.estado && before.estado !== 'Anulada') ? (before.valorTotal || 0) : 0;
        const ventaAfter = (after.estado && after.estado !== 'Anulada') ? (after.valorTotal || 0) : 0;

        // 2. Calcular Ingreso (Solo pagos confirmados)
        // NOTA: Para el ingreso usamos la fecha del PAGO, no de la remisión. 
        // Pero para mantener simpleza en este dashboard, seguiremos usando fecha de remisión por ahora 
        // o la fecha de la remisión para agrupar.
        const ingresoBefore = (before.payments || []).filter(p => p.status === 'confirmado').reduce((acc, p) => acc + p.amount, 0);
        const ingresoAfter = (after.payments || []).filter(p => p.status === 'confirmado').reduce((acc, p) => acc + p.amount, 0);

        // 3. Detectar Fechas (Meses)
        const dateBefore = before.fechaRecibido;
        const dateAfter = after.fechaRecibido;

        // Si no hay cambios en valores ni fechas, salir
        if (ventaBefore === ventaAfter && ingresoBefore === ingresoAfter && dateBefore === dateAfter) return null;

        const batch = admin.firestore().batch();

        // CASO A: La fecha cambió (Movemos los valores del mes viejo al mes nuevo)
        if (dateBefore && dateAfter && dateBefore.substring(0, 7) !== dateAfter.substring(0, 7)) {
            // Restar del mes viejo
            const oldId = `${new Date(dateBefore).getFullYear()}_${(new Date(dateBefore).getMonth() + 1).toString().padStart(2, '0')}`;
            const oldRef = admin.firestore().collection("estadisticas_mensuales").doc(oldId);
            batch.set(oldRef, {
                totalVentas: admin.firestore.FieldValue.increment(-ventaBefore),
                totalIngresos: admin.firestore.FieldValue.increment(-ingresoBefore)
            }, { merge: true });

            // Sumar al mes nuevo
            const newId = `${new Date(dateAfter).getFullYear()}_${(new Date(dateAfter).getMonth() + 1).toString().padStart(2, '0')}`;
            const newRef = admin.firestore().collection("estadisticas_mensuales").doc(newId);
            batch.set(newRef, {
                totalVentas: admin.firestore.FieldValue.increment(ventaAfter),
                totalIngresos: admin.firestore.FieldValue.increment(ingresoAfter),
                ultimaActualizacion: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
        } 
        // CASO B: La fecha es la misma o es creación/borrado (Actualización simple)
        else {
            const date = dateAfter || dateBefore;
            if (!date) return null; // Seguridad

            const docId = `${new Date(date).getFullYear()}_${(new Date(date).getMonth() + 1).toString().padStart(2, '0')}`;
            const ref = admin.firestore().collection("estadisticas_mensuales").doc(docId);

            batch.set(ref, {
                totalVentas: admin.firestore.FieldValue.increment(ventaAfter - ventaBefore),
                totalIngresos: admin.firestore.FieldValue.increment(ingresoAfter - ingresoBefore),
                ultimaActualizacion: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
        }

        return batch.commit();
    });

/**
 * Trigger: Escucha cambios en GASTOS para actualizar egresos
 */
exports.aggregateGastos = functions.firestore
    .document("gastos/{gastoId}")
    .onWrite(async (change, context) => {
        const before = change.before.exists ? change.before.data() : null;
        const after = change.after.exists ? change.after.data() : null;

        const expenseBefore = before ? (before.valorTotal || 0) : 0;
        const expenseAfter = after ? (after.valorTotal || 0) : 0;

        const deltaExpense = expenseAfter - expenseBefore;

        if (deltaExpense === 0) return null;

        const dateStr = after ? after.fecha : before.fecha;
        return updateMonthlyStats(dateStr, 0, 0, deltaExpense);
    });

/**
 * Callable: REGENERAR HISTORIAL (Versión Corregida)
 */
exports.rebuildMonthlyStats = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Auth requerida");
    
    // 1. Leer TODAS las colecciones necesarias
    const remSnap = await admin.firestore().collection("remisiones").get();
    const gastoSnap = await admin.firestore().collection("gastos").get();
    
    const stats = {}; 

    // Helper para inicializar objeto
    const initMonth = (key) => {
        if (!stats[key]) stats[key] = { ventas: 0, ingresos: 0, gastos: 0 };
    };

    // Procesar Remisiones
    remSnap.forEach(doc => {
        const r = doc.data();
        if (!r.fechaRecibido) return;
        
        // Obtener KEY del mes (YYYY_MM) basado en fechaRecibido
        // IMPORTANTE: Usamos UTC o local consistente para evitar desfases de día
        // Simple string split es más seguro para fechas YYYY-MM-DD
        const [year, month] = r.fechaRecibido.split('-'); 
        const key = `${year}_${month}`; 
        
        initMonth(key);
        
        // LOGICA DE VENTAS: Sumar Valor Total si no es anulada
        if (r.estado !== 'Anulada') {
            stats[key].ventas += (r.valorTotal || 0);
        }
        
        // LOGICA DE INGRESOS: Sumar pagos confirmados
        const pagado = (r.payments || []).filter(p => p.status === 'confirmado').reduce((sum, p) => sum + p.amount, 0);
        stats[key].ingresos += pagado;
    });

    // Procesar Gastos
    gastoSnap.forEach(doc => {
        const g = doc.data();
        if (!g.fecha) return;
        const [year, month] = g.fecha.split('-');
        const key = `${year}_${month}`;
        
        initMonth(key);
        stats[key].gastos += (g.valorTotal || 0);
    });

    // Guardar en Firestore (Sobreescribimos para limpiar errores previos)
    const batch = admin.firestore().batch();
    Object.keys(stats).forEach(key => {
        const ref = admin.firestore().collection("estadisticas_mensuales").doc(key);
        batch.set(ref, {
            totalVentas: stats[key].ventas,
            totalIngresos: stats[key].ingresos,
            totalGastos: stats[key].gastos,
            ultimaActualizacion: admin.firestore.FieldValue.serverTimestamp()
        });
    });

    await batch.commit();
    return { success: true, processedMonths: Object.keys(stats).length };
});

/**
 * Callable: RECALCULAR SALDOS GLOBALES (Caja y Bancos)
 * VERSIÓN BLINDADA: Asegura tipos numéricos y consistencia.
 */
exports.recalcularSaldosGlobales = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Auth requerida");

    // 1. Obtener Saldos Iniciales (Configuración base)
    const configDoc = await admin.firestore().collection('configuracion').doc('saldos_globales').get();
    const saldosBase = configDoc.exists ? configDoc.data() : { Efectivo: 0, Nequi: 0, Davivienda: 0 };

    // Inicializamos asegurando que sean números
    let saldos = {
        saldoEfectivo: Number(saldosBase.Efectivo || 0),
        saldoNequi: Number(saldosBase.Nequi || 0),
        saldoDavivienda: Number(saldosBase.Davivienda || 0)
    };

    // 2. Sumar INGRESOS (Pagos Confirmados en Remisiones)
    const remSnap = await admin.firestore().collection("remisiones")
        .select('payments', 'estado') // Solo traemos lo necesario
        .get();
    
    remSnap.forEach(doc => {
        const r = doc.data();
        
        // Solo sumamos si NO está anulada y TIENE pagos
        if (r.estado !== 'Anulada' && Array.isArray(r.payments)) {
            r.payments.forEach(p => {
                if (p.status === 'confirmado') {
                    const monto = Number(p.amount || 0); // Forzar número
                    const metodo = (p.method || "").trim(); // Quitar espacios

                    // Comparación flexible
                    if (metodo === 'Efectivo') saldos.saldoEfectivo += monto;
                    else if (metodo === 'Nequi') saldos.saldoNequi += monto;
                    else if (metodo === 'Davivienda') saldos.saldoDavivienda += monto;
                }
            });
        }
    });

    // 3. Restar EGRESOS (Gastos)
    const gasSnap = await admin.firestore().collection("gastos")
        .select('fuentePago', 'valorTotal')
        .get();
    
    gasSnap.forEach(doc => {
        const g = doc.data();
        const monto = Number(g.valorTotal || 0); // Forzar número
        const metodo = (g.fuentePago || "").trim();

        if (metodo === 'Efectivo') saldos.saldoEfectivo -= monto;
        else if (metodo === 'Nequi') saldos.saldoNequi -= monto;
        else if (metodo === 'Davivienda') saldos.saldoDavivienda -= monto;
    });

    // 4. Redondear para evitar decimales extraños (ej: 100.00000001)
    saldos.saldoEfectivo = Math.round(saldos.saldoEfectivo);
    saldos.saldoNequi = Math.round(saldos.saldoNequi);
    saldos.saldoDavivienda = Math.round(saldos.saldoDavivienda);

    // 5. Guardar Resultado Final
    await admin.firestore().collection("estadisticas").doc("globales").set(saldos);

    return { success: true, saldosCalculados: saldos };
});

/**
 * Callable: EXPORTAR DATOS (Optimizado)
 */
exports.getDataForExport = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Auth requerida");

    const { type, startDate, endDate } = data;
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    // VALIDACIÓN DE SEGURIDAD: Aumentado a 1 año (366 días)
    const diffTime = Math.abs(end - start);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
    
    // --- CAMBIO AQUÍ ---
    if (diffDays > 366) {
        throw new functions.https.HttpsError("invalid-argument", "Por seguridad, el rango máximo es de 1 año.");
    }
    // -------------------

    const results = [];

    if (type === 'gastos') {
        // Solo traemos lo necesario para el Excel, ahorrando transferencia
        const q = await admin.firestore().collection("gastos")
            .where("fecha", ">=", startDate)
            .where("fecha", "<=", endDate)
            .select("fecha", "proveedorNombre", "numeroFactura", "valorTotal", "fuentePago", "descripcion", "categoria") 
            .get();

        q.forEach(doc => results.push(doc.data()));
    } 
    
    else if (type === 'remisiones') {
        // No traemos 'items' ni 'historial', solo totales y encabezados
        const q = await admin.firestore().collection("remisiones")
            .where("fechaRecibido", ">=", startDate)
            .where("fechaRecibido", "<=", endDate)
            .where("estado", "!=", "Anulada")
            .select("numeroRemision", "fechaRecibido", "clienteNombre", "estado", "subtotal", "valorIVA", "valorTotal", "formaPago", "facturado", "numeroFactura")
            .get();

        q.forEach(doc => results.push(doc.data()));
    }

    else if (type === 'pagos') {
        // Para pagos, necesitamos leer las remisiones, pero solo traemos el array de pagos y cliente
        const q = await admin.firestore().collection("remisiones")
            .where("fechaRecibido", ">=", startDate) // Aprox, luego filtramos exacto en memoria
            .where("fechaRecibido", "<=", endDate) // Aprox
            .select("numeroRemision", "clienteNombre", "payments")
            .get();

        q.forEach(doc => {
            const r = doc.data();
            if (r.payments && Array.isArray(r.payments)) {
                r.payments.forEach(p => {
                    // Doble verificación de fecha del pago específico
                    if (p.date >= startDate && p.date <= endDate) {
                        results.push({
                            fecha: p.date,
                            remision: r.numeroRemision,
                            cliente: r.clienteNombre,
                            metodo: p.method,
                            monto: p.amount,
                            estado: p.status,
                            registradoPor: p.registeredBy // ID del usuario (habría que mapear nombre en cliente si se desea)
                        });
                    }
                });
            }
        });
    }

    return { data: results, count: results.length };
});

// ==========================================
//              EXPORTS FINALES (CORREGIDO)
// ==========================================

// Usamos el objeto importado al inicio
exports.whatsappWebhook = waWebhook.whatsappWebhook;
exports.sendWhatsAppMessage = waWebhook.sendWhatsAppMessage;