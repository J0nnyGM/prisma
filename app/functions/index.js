require('dotenv').config();

const functions = require("firebase-functions");
const cors = require("cors")({ origin: true });
const admin = require("firebase-admin");
const sgMail = require("@sendgrid/mail");
const { jsPDF } = require("jspdf");
require("jspdf-autotable");
const axios = require("axios");

admin.initializeApp();

// --- CONFIGURACIÓN CON VARIABLES DE ENTORNO (.ENV) ---

// Configurar SendGrid
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
const FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL;

if (SENDGRID_API_KEY) {
    // Limpiamos la clave por si se colaron espacios o comillas del .env
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
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;

const BUCKET_NAME = "prismacolorsas.firebasestorage.app";


// ==========================================
//              FUNCIONES ÚTILES
// ==========================================

/**
 * Formatea un número como moneda colombiana (COP).
 */
function formatCurrency(value) {
    return new Intl.NumberFormat("es-CO", {
        style: "currency",
        currency: "COP",
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    }).format(value || 0);
}

/**
 * Formatea un número de teléfono de Colombia al formato E.164.
 */
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
 * --- NUEVO: Envía un mensaje de plantilla de WhatsApp con un documento. ---
 * @param {string} toPhoneNumber Número del destinatario en formato E.164.
 * @param {string} customerName Nombre del cliente para la plantilla.
 * @param {string} remisionNumber Número de la remisión.
 * @param {string} status Estado actual de la remisión.
 * @param {string} pdfUrl URL pública del PDF a enviar.
 * @return {Promise<object>} La respuesta de la API de Meta.
 */
async function sendWhatsAppRemision(toPhoneNumber, customerName, remisionNumber, status, pdfUrl) {
    const formattedPhone = formatColombianPhone(toPhoneNumber);
    if (!formattedPhone) {
        throw new Error("Número de teléfono inválido o no proporcionado.");
    }

    const API_VERSION = "v19.0";
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

/**
 * Función para generar un PDF de la remisión.
 * @param {object} remision El objeto con los datos de la remisión.
 * @param {boolean} isForPlanta Indica si el PDF es para el rol de planta.
 * @return {Buffer} El PDF como un buffer de datos.
 */
function generarPDF(remisionData, esPlanta) {
    const remision = remisionData; 
    const isForPlanta = esPlanta;
    
    // eslint-disable-next-line new-cap
    const doc = new jsPDF();

    doc.setFontSize(20);
    doc.setFont("helvetica", "bold");
    doc.text("REMISION DE SERVICIO", 105, 20, { align: "center" });

    // Marca de agua "ANULADA"
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

    // Observaciones
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

    // Firma
    yPos = Math.max(yPos, finalY + 20);
    yPos = 250;
    doc.line(40, yPos, 120, yPos);
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text("Firma y Sello de Recibido", 75, yPos + 5, { align: "center" });

    // Footer
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

/**
 * Se activa al crear un nuevo usuario.
 * Asigna rol 'admin' al primero, 'planta' a los demás.
 */
exports.onUserCreate = functions.auth.user().onCreate(async (user) => {
    const usersCollection = admin.firestore().collection("users");
    const snapshot = await usersCollection.limit(2).get();

    // Si es el primer usuario, lo hacemos admin y lo activamos
    if (snapshot.size === 1) {
        functions.logger.log(`Asignando rol de 'admin' y estado 'active' al primer usuario: ${user.uid}`);
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

    functions.logger.log(`Nuevo usuario ${user.uid} registrado como 'planta' (pending).`);
    return null;
});

/**
 * Trigger al CREAR Remisión: Genera PDFs, guarda rutas y envía notificaciones.
 */
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

            // URL firmada v4 para enviar en las notificaciones
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
                    const telefonos = [clienteData.telefono1, clienteData.telefono2].filter(Boolean);

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
 * Trigger al ACTUALIZAR Remisión: Detecta cambios de estado (Anulada/Entregado) o pagos totales.
 */
exports.onRemisionUpdate = functions.region("us-central1").firestore
    .document("remisiones/{remisionId}")
    .onUpdate(async (change, context) => {
        const beforeData = change.before.data();
        const afterData = change.after.data();
        const remisionId = context.params.remisionId;
        const log = (message) => functions.logger.log(`[Upd ${remisionId}] ${message}`);

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

        // 1. Cambio de Estado (Anulada / Entregado)
        if ((beforeData.estado !== "Anulada" && afterData.estado === "Anulada") || (beforeData.estado !== "Entregado" && afterData.estado === "Entregado")) {
            const motivo = afterData.estado === "Anulada" ? "Anulación" : "Entrega";
            try {
                const { pdfUrl, pdfBuffer } = await regeneratePdfs(afterData);
                await sendNotifications(motivo, pdfUrl, pdfBuffer);
            } catch (e) { log(`Error procesando ${motivo}: ${e}`); }
        }
        
        // 2. Pago Final
        const totalPagadoAntes = (beforeData.payments || []).filter((p) => p.status === "confirmado").reduce((sum, p) => sum + p.amount, 0);
        const totalPagadoDespues = (afterData.payments || []).filter((p) => p.status === "confirmado").reduce((sum, p) => sum + p.amount, 0);

        if (totalPagadoAntes < afterData.valorTotal && totalPagadoDespues >= afterData.valorTotal) {
            log("Pago final detectado.");
            try {
                const updatedData = { ...afterData, formaPago: "Cancelado" };
                const { pdfBuffer } = await regeneratePdfs(updatedData);

                await change.after.ref.update({ formaPago: "Cancelado" });

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
            } catch (e) { log(`Error pago final: ${e}`); }
        }

        return null;
    });

/**
 * Trigger para Reenviar Correo manualmente (desde un botón en el front).
 */
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


// ==========================================
//              FUNCIONES CALLABLE (HTTP)
// ==========================================

/**
 * Devuelve la configuración de Firebase al cliente usando .ENV
 */
exports.getFirebaseConfig = functions.https.onCall((data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "Auth requerida.");
    }

    const config = {
        apiKey: process.env.PRISMA_API_KEY,
        authDomain: process.env.PRISMA_AUTH_DOMAIN,
        projectId: process.env.PRISMA_PROJECT_ID,
        storageBucket: process.env.PRISMA_STORAGE_BUCKET,
        messagingSenderId: process.env.PRISMA_MESSAGING_SENDER_ID,
        appId: process.env.PRISMA_APP_ID,
        measurementId: process.env.PRISMA_MEASUREMENT_ID
    };

    if (!config.apiKey) {
        throw new functions.https.HttpsError("internal", "Configuración de servidor incompleta.");
    }
    return config;
});

/**
 * Aplica un descuento a una remisión.
 */
exports.applyDiscount = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Auth requerida.");

    const { remisionId, discountPercentage } = data;
    if (discountPercentage < 0 || discountPercentage > 5.0001) {
        throw new functions.https.HttpsError("out-of-range", "Descuento máximo 5%.");
    }

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

        // Regenerar PDF y notificar
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

/**
 * Actualiza documentos de empleados (Admin only).
 */
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

/**
 * Obtiene URL firmada (V4) para ver archivos protegidos.
 */
exports.getSignedUrlForPath = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Auth requerida.");
    
    const bucket = admin.storage().bucket(BUCKET_NAME);
    const [signedUrl] = await bucket.file(data.path).getSignedUrl({
        action: 'read',
        expires: Date.now() + 15 * 60 * 1000, // 15 min
        version: 'v4', 
    });
    return { url: signedUrl };
});

/**
 * Repara URLs firmadas que hayan caducado o estén rotas (Admin tool).
 */
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
                } catch (_) {}
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

/**
 * NUEVO: Aplica retenciones financieras (Restar del saldo).
 * CORRECCIÓN: Ahora es genérica, no pide tipo específico.
 */
exports.applyRetention = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Auth requerida.");

    // Ya no extraemos 'retentionType'
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
                method: "Retención", // <--- AHORA ES UN NOMBRE FIJO Y GENÉRICO
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