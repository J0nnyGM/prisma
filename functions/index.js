/**
 * Este es el código para tus Firebase Functions.
 * Debes desplegarlo usando Firebase CLI.
 */
const functions = require("firebase-functions");
const cors = require("cors")({ origin: true });
const admin = require("firebase-admin");
const sgMail = require("@sendgrid/mail");
const { jsPDF } = require("jspdf");
require("jspdf-autotable");
const axios = require("axios"); // Importar axios

// Inicializar Firebase Admin SDK
admin.initializeApp();

// Configurar SendGrid
const SENDGRID_API_KEY = functions.config().sendgrid.key;
const FROM_EMAIL = functions.config().sendgrid.from_email;
sgMail.setApiKey(SENDGRID_API_KEY);

// --- NUEVO: Configuración de WhatsApp ---
const WHATSAPP_TOKEN = functions.config().whatsapp.token;
const WHATSAPP_PHONE_NUMBER_ID = functions.config().whatsapp.phone_number_id;

const BUCKET_NAME = "prismacolorsas.firebasestorage.app";

// **** INICIO DE LA NUEVA FUNCIÓN ****
/**
 * Se activa cuando un nuevo usuario se crea en Firebase Authentication.
 * Revisa si es el primer usuario y, si es así, le asigna el rol de 'admin'.
 */
exports.onUserCreate = functions.auth.user().onCreate(async (user) => {
  const usersCollection = admin.firestore().collection("users");
  
  // Revisa cuántos documentos hay en la colección de usuarios.
  const snapshot = await usersCollection.limit(2).get();

  // Si solo hay 1 documento (el que se acaba de crear), es el primer usuario.
  if (snapshot.size === 1) {
    functions.logger.log(`Asignando rol de 'admin' al primer usuario: ${user.uid}`);
    // Actualiza el documento del usuario para cambiar su rol a 'admin'.
    return usersCollection.doc(user.uid).update({
      role: "admin",
      "permissions.facturacion": true,
      "permissions.clientes": true,
      "permissions.items": true,
      "permissions.colores": true,
      "permissions.gastos": true,
      "permissions.proveedores": true,
      "permissions.empleados": true,
    });
  }
  
  functions.logger.log(`Asignando rol de 'planta' al nuevo usuario: ${user.uid}`);
  return null; // No hace nada para los siguientes usuarios.
});

/**
 * Formatea un número como moneda colombiana (COP).
 * @param {number} value El valor numérico a formatear.
 * @return {string} El valor formateado como moneda.
 */
function formatCurrency(value) {
    return new Intl.NumberFormat("es-CO", {
        style: "currency",
        currency: "COP",
        minimumFractionDigits: 0,
    }).format(value || 0);
}

// Función HTTP que devuelve la configuración de Firebase del lado del cliente.
exports.getFirebaseConfig = functions.https.onRequest((request, response) => {
  // Usamos cors para permitir que tu página web llame a esta función.
  cors(request, response, () => {
    // Verifica que la configuración exista antes de enviarla.
    if (!functions.config().prisma) {
      return response.status(500).json({
        error: "La configuración de Firebase no está definida en el servidor.",
      });
    }
    // Envía la configuración como una respuesta JSON.
    return response.status(200).json(functions.config().prisma);
  });
});

/**
 * --- NUEVO: Formatea un número de teléfono de Colombia al formato E.164. ---
 * @param {string} phone El número de teléfono.
 * @return {string|null} El número formateado o null si es inválido.
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
            name: "envio_remision", // Asegúrate que este sea el nombre de tu plantilla aprobada
            language: {
                code: "es",
            },
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
function generarPDF(remision, isForPlanta = false) {
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

    // Signature Line
    yPos = Math.max(yPos, finalY + 20); // Ensure there's enough space after the table
    yPos = 250; // Set a fixed position for the signature line
    doc.line(40, yPos, 120, yPos); // Draw the line for signature
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text("Firma y Sello de Recibido", 75, yPos + 5, { align: "center" });


    // Footer Note
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

exports.onRemisionCreate = functions.region("us-central1").firestore
    .document("remisiones/{remisionId}")
    .onCreate(async (snap, context) => {
        const remisionData = snap.data();
        const remisionId = context.params.remisionId;
        const log = (message) => functions.logger.log(`[${remisionId}] ${message}`);

        log("Ejecutando v4 - Despliegue Limpio");

        let emailStatus = "pending";
        let whatsappStatus = "pending";

        try {
            const pdfBuffer = generarPDF(remisionData, false);
            log("PDF de cliente generado.");
            const pdfPlantaBuffer = generarPDF(remisionData, true);
            log("PDF de planta generado.");

            const bucket = admin.storage().bucket(BUCKET_NAME);
            const filePath = `remisiones/${remisionData.numeroRemision}.pdf`;
            const file = bucket.file(filePath);
            await file.save(pdfBuffer, { metadata: { contentType: "application/pdf" } });
            log(`PDF de cliente guardado en Storage: ${filePath}`);

            const filePathPlanta = `remisiones/planta-${remisionData.numeroRemision}.pdf`;
            const filePlanta = bucket.file(filePathPlanta);
            await filePlanta.save(pdfPlantaBuffer, { metadata: { contentType: "application/pdf" } });
            log(`PDF de planta guardado en Storage: ${filePathPlanta}`);

            const [url] = await file.getSignedUrl({ action: "read", expires: "03-09-2491" });
            const [urlPlanta] = await filePlanta.getSignedUrl({ action: "read", expires: "03-09-2491" });
            log("URLs públicas de PDFs obtenidas.");

            await snap.ref.update({ pdfUrl: url, pdfPlantaUrl: urlPlanta });

            // --- Lógica de envío de Correo Electrónico ---
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
                log(`Correo enviado exitosamente a ${remisionData.clienteEmail}.`);
                emailStatus = "sent";
            } catch (emailError) {
                log("Error al enviar correo:", emailError);
                emailStatus = "error";
            }

            // --- Lógica de envío a Impresora ---
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
                log(`Copia de remisión enviada a la impresora.`);
            } catch (printerError) {
                log("Error al enviar a la impresora:", printerError);
            }

            // --- Lógica de envío de WhatsApp ---
            try {
                const clienteDoc = await admin.firestore().collection("clientes").doc(remisionData.idCliente).get();
                const docExists = clienteDoc && (typeof clienteDoc.exists === "function" ? clienteDoc.exists() : clienteDoc.exists);

                if (docExists) {
                    const clienteData = clienteDoc.data();
                    const telefono = clienteData.telefono1 || clienteData.telefono2;
                    if (telefono) {
                        await sendWhatsAppRemision(
                            telefono,
                            remisionData.clienteNombre,
                            remisionData.numeroRemision.toString(),
                            remisionData.estado,
                            url
                        );
                        log(`Mensaje de WhatsApp enviado a ${telefono}.`);
                        whatsappStatus = "sent";
                    } else {
                        log("El cliente no tiene un número de teléfono registrado.");
                        whatsappStatus = "no_phone";
                    }
                } else {
                    log("No se encontró el documento del cliente para obtener el teléfono.");
                    whatsappStatus = "client_not_found";
                }
            } catch (whatsappError) {
                functions.logger.error(
                    `[${remisionId}] Error al enviar WhatsApp:`,
                    {
                        errorMessage: whatsappError.message,
                        responseData: whatsappError.response ? whatsappError.response.data : "No response data",
                        statusCode: whatsappError.response ? whatsappError.response.status : "No status code",
                    },
                );
                whatsappStatus = "error";
            }

            return snap.ref.update({
                emailStatus: emailStatus,
                whatsappStatus: whatsappStatus,
            });

        } catch (error) {
            functions.logger.error(`[${remisionId}] Error General:`, error);
            return snap.ref.update({
                emailStatus: "error",
                whatsappStatus: "error",
            });
        }
    });

exports.onRemisionUpdate = functions.region("us-central1").firestore
    .document("remisiones/{remisionId}")
    .onUpdate(async (change, context) => {
        const beforeData = change.before.data();
        const afterData = change.after.data();
        const remisionId = context.params.remisionId;
        const log = (message) => {
            functions.logger.log(`[Actualización ${remisionId}] ${message}`);
        };

        // Disparador para anulación
        if (beforeData.estado !== "Anulada" && afterData.estado === "Anulada") {
            log("Detectada anulación. Generando PDF y enviando correo.");
            try {
                const pdfBuffer = generarPDF(afterData, false);
                const pdfPlantaBuffer = generarPDF(afterData, true);
                log("PDFs de anulación generados.");

                const bucket = admin.storage().bucket(BUCKET_NAME);
                const filePath = `remisiones/${afterData.numeroRemision}.pdf`;
                const file = bucket.file(filePath);
                await file.save(pdfBuffer, { metadata: { contentType: "application/pdf" } });

                const filePathPlanta = `remisiones/planta-${afterData.numeroRemision}.pdf`;
                const filePlanta = bucket.file(filePathPlanta);
                await filePlanta.save(pdfPlantaBuffer, { metadata: { contentType: "application/pdf" } });

                const [url] = await file.getSignedUrl({ action: "read", expires: "03-09-2491" });
                const [urlPlanta] = await filePlanta.getSignedUrl({ action: "read", expires: "03-09-2491" });

                await change.after.ref.update({ pdfUrl: url, pdfPlantaUrl: urlPlanta });
                log("PDFs de anulación actualizados en Storage y Firestore.");

                const msg = {
                    to: afterData.clienteEmail,
                    from: FROM_EMAIL,
                    subject: `Anulación de Remisión N° ${afterData.numeroRemision}`,
                    html: `<p>Hola ${afterData.clienteNombre},</p>
                <p>Te informamos que la remisión N° <strong>${afterData.numeroRemision}</strong> ha sido anulada.</p>
                <p>Adjuntamos una copia del documento anulado para tus registros.</p>
                <p><strong>Prismacolor S.A.S.</strong></p>`,
                    attachments: [{
                        content: pdfBuffer.toString("base64"),
                        filename: `Remision-ANULADA-${afterData.numeroRemision}.pdf`,
                        type: "application/pdf",
                        disposition: "attachment",
                    }],
                };
                await sgMail.send(msg);
                log(`Correo de anulación con PDF enviado a ${afterData.clienteEmail}.`);
            } catch (error) {
                log("Error al procesar anulación:", error);
            }
        }

        // Disparador para "Entregado"
        if (beforeData.estado !== "Entregado" && afterData.estado === "Entregado") {
            log("Detectado cambio a 'Entregado'. Generando PDF y enviando correo.");
            try {
                const pdfBuffer = generarPDF(afterData, false);
                log("PDF de entrega generado.");

                const bucket = admin.storage().bucket(BUCKET_NAME);
                const filePath = `remisiones/${afterData.numeroRemision}.pdf`;
                const file = bucket.file(filePath);
                await file.save(pdfBuffer, { metadata: { contentType: "application/pdf" } });
                log(`PDF actualizado en Storage en: ${filePath}`);

                const msg = {
                    to: afterData.clienteEmail,
                    from: FROM_EMAIL,
                    subject: `Tu orden N° ${afterData.numeroRemision} ha sido entregada`,
                    html: `<p>Hola ${afterData.clienteNombre},</p>
            <p>Te informamos que tu orden N° <strong>${afterData.numeroRemision}</strong> ha sido completada y marcada como <strong>entregada</strong>.</p>
            <p>Adjuntamos una copia final de la remisión para tus registros.</p>
            <p>¡Gracias por tu preferencia!</p>
            <p><strong>Prismacolor S.A.S.</strong></p>`,
                    attachments: [{
                        content: pdfBuffer.toString("base64"),
                        filename: `Remision-ENTREGADA-${afterData.numeroRemision}.pdf`,
                        type: "application/pdf",
                        disposition: "attachment",
                    }],
                };
                await sgMail.send(msg);
                log(`Correo de entrega enviado a ${afterData.clienteEmail}.`);
            } catch (error) {
                log("Error al enviar correo de entrega:", error);
            }
        }

        // Disparador para PAGO FINAL
        const totalPagadoAntes = (beforeData.payments || []).filter((p) => p.status === "confirmado").reduce((sum, p) => sum + p.amount, 0);
        const totalPagadoDespues = (afterData.payments || []).filter((p) => p.status === "confirmado").reduce((sum, p) => sum + p.amount, 0);

        if (totalPagadoAntes < afterData.valorTotal && totalPagadoDespues >= afterData.valorTotal) {
            log("Detectado pago final. Generando PDF y enviando correo de confirmación.");
            try {
                const updatedRemisionData = { ...afterData, formaPago: "Cancelado" };
                const pdfBuffer = generarPDF(updatedRemisionData, false);
                log("PDF de pago final generado.");

                const bucket = admin.storage().bucket(BUCKET_NAME);
                const filePath = `remisiones/${afterData.numeroRemision}.pdf`;
                const file = bucket.file(filePath);
                await file.save(pdfBuffer, { metadata: { contentType: "application/pdf" } });
                log(`PDF de pago final actualizado en Storage: ${filePath}`);

                const [url] = await file.getSignedUrl({ action: "read", expires: "03-09-2491" });
                await change.after.ref.update({ pdfUrl: url, formaPago: "Cancelado" });
                log("URL del PDF y forma de pago actualizados en Firestore.");

                const ultimoPago = afterData.payments[afterData.payments.length - 1];

                const msg = {
                    to: afterData.clienteEmail,
                    from: FROM_EMAIL,
                    subject: `Confirmación de Pago Total - Remisión N° ${afterData.numeroRemision}`,
                    html: `<p>Hola ${afterData.clienteNombre},</p>
                  <p>Hemos recibido el pago final para tu remisión N° <strong>${afterData.numeroRemision}</strong>.</p>
                  <p>El valor total ha sido cancelado. Último pago registrado por ${ultimoPago.method}.</p>
                  <p>Adjuntamos la remisión actualizada para tus registros.</p>
                  <p>¡Gracias por tu confianza!</p>
                  <p><strong>Prismacolor S.A.S.</strong></p>`,
                    attachments: [{
                        content: pdfBuffer.toString("base64"),
                        filename: `Remision-CANCELADA-${afterData.numeroRemision}.pdf`,
                        type: "application/pdf",
                        disposition: "attachment",
                    }],
                };
                await sgMail.send(msg);
                log(`Correo de pago final enviado a ${afterData.clienteEmail}.`);
            } catch (error) {
                log("Error al procesar el pago final:", error);
            }
        }

        return null;
    });

// Función HTTP invocable que devuelve la configuración de Firebase del lado del cliente.
exports.getFirebaseConfig = functions.https.onCall((data, context) => {
    // Asegurarse de que el usuario esté autenticado para solicitar la configuración es una buena práctica.
     if (!context.auth) {
       throw new functions.https.HttpsError(
         "unauthenticated",
         "El usuario debe estar autenticado para solicitar la configuración."
       );
    }

    // Devuelve la configuración guardada en el entorno.
    return functions.config().prisma;
});

exports.applyDiscount = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "El usuario no está autenticado.");
    }

    const { remisionId, discountPercentage } = data;
    if (!remisionId || discountPercentage === undefined) {
        throw new functions.https.HttpsError("invalid-argument", "Faltan datos (remisionId, discountPercentage).");
    }

    if (discountPercentage < 0 || discountPercentage > 5.0001) { // Allow for small floating point inaccuracies
        throw new functions.https.HttpsError("out-of-range", "El descuento debe estar entre 0 y 5%.");
    }

    const remisionRef = admin.firestore().collection("remisiones").doc(remisionId);

    try {
        const remisionDoc = await remisionRef.get();
        const docExists = remisionDoc && (typeof remisionDoc.exists === "function" ? remisionDoc.exists() : remisionDoc.exists);
        if (!docExists) {
            throw new functions.https.HttpsError("not-found", "La remisión no existe.");
        }

        const remisionData = remisionDoc.data();
        const subtotal = remisionData.subtotal;
        const discountAmount = subtotal * (discountPercentage / 100);
        const subtotalWithDiscount = subtotal - discountAmount;
        const newIva = remisionData.incluyeIVA ? subtotalWithDiscount * 0.19 : 0;
        const newTotal = subtotalWithDiscount + newIva;

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

        const finalRemisionData = { ...remisionData, ...updatedData };
        const pdfBuffer = generarPDF(finalRemisionData, false);
        const pdfPlantaBuffer = generarPDF(finalRemisionData, true);

        const bucket = admin.storage().bucket(BUCKET_NAME);
        const filePath = `remisiones/${finalRemisionData.numeroRemision}.pdf`;
        const file = bucket.file(filePath);
        await file.save(pdfBuffer, { metadata: { contentType: "application/pdf" } });

        const filePathPlanta = `remisiones/planta-${finalRemisionData.numeroRemision}.pdf`;
        const filePlanta = bucket.file(filePathPlanta);
        await filePlanta.save(pdfPlantaBuffer, { metadata: { contentType: "application/pdf" } });

        const [url] = await file.getSignedUrl({ action: "read", expires: "03-09-2491" });
        const [urlPlanta] = await filePlanta.getSignedUrl({ action: "read", expires: "03-09-2491" });

        await remisionRef.update({ pdfUrl: url, pdfPlantaUrl: urlPlanta });

        const msg = {
            to: finalRemisionData.clienteEmail,
            from: FROM_EMAIL,
            subject: `Descuento aplicado a tu Remisión N° ${finalRemisionData.numeroRemision}`,
            html: `<p>Hola ${finalRemisionData.clienteNombre},</p>
                   <p>Se ha aplicado un descuento del <strong>${discountPercentage.toFixed(2)}%</strong> a tu remisión N° ${finalRemisionData.numeroRemision}.</p>
                   <p>El nuevo total es: <strong>${formatCurrency(newTotal)}</strong>.</p>
                   <p>Adjuntamos la remisión actualizada.</p>
                   <p><strong>Prismacolor S.A.S.</strong></p>`,
            attachments: [{
                content: pdfBuffer.toString("base64"),
                filename: `Remision-Actualizada-${finalRemisionData.numeroRemision}.pdf`,
                type: "application/pdf",
                disposition: "attachment",
            }],
        };

        await sgMail.send(msg);

        return { success: true, message: "Descuento aplicado y correo enviado." };

    } catch (error) {
        functions.logger.error(`Error al aplicar descuento para ${remisionId}:`, error);
        throw new functions.https.HttpsError("internal", "No se pudo aplicar el descuento.");
    }
});


exports.onResendEmailRequest = functions.region("us-central1").firestore
    .document("resendQueue/{queueId}")
    .onCreate(async (snap, context) => {
        const request = snap.data();
        const remisionId = request.remisionId;
        const log = (message) => {
            functions.logger.log(`[Reenvío ${remisionId}] ${message}`);
        };
        log("Iniciando reenvío de correo.");

        try {
            const remisionDoc = await admin.firestore()
                .collection("remisiones").doc(remisionId).get();
            const docExists = remisionDoc && (typeof remisionDoc.exists === "function" ? remisionDoc.exists() : remisionDoc.exists);
            if (!docExists) {
                log("La remisión no existe.");
                return snap.ref.delete();
            }
            const remisionData = remisionDoc.data();

            const bucket = admin.storage().bucket(BUCKET_NAME);
            const filePath = `remisiones/${remisionData.numeroRemision}.pdf`;
            const [pdfBuffer] = await bucket.file(filePath).download();
            log("PDF descargado desde Storage.");

            const msg = {
                to: remisionData.clienteEmail,
                from: FROM_EMAIL,
                subject: `[Reenvío] Remisión N° ${remisionData.numeroRemision}`,
                html: `<p>Hola ${remisionData.clienteNombre},</p>
          <p>Como solicitaste, aquí tienes una copia de tu remisión.</p>`,
                attachments: [{
                    content: pdfBuffer.toString("base64"),
                    filename: `Remision-${remisionData.numeroRemision}.pdf`,
                    type: "application/pdf",
                    disposition: "attachment",
                }],
            };
            await sgMail.send(msg);
            log(`Correo reenviado a ${remisionData.clienteEmail}.`);

            return snap.ref.delete();
        } catch (error) {
            log("Error en el reenvío:", error);
            return snap.ref.update({ status: "error", error: error.message });
        }
    });

/**
 * NUEVA FUNCIÓN: Actualiza el documento de un empleado con la URL de un archivo.
 * Se invoca desde el cliente después de subir un archivo a Firebase Storage.
 */
exports.updateEmployeeDocument = functions.https.onCall(async (data, context) => {
    // 1. Autenticación y Verificación de Permisos
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "El usuario no está autenticado.");
    }

    const uid = context.auth.uid;
    const userDoc = await admin.firestore().collection("users").doc(uid).get();
    const userData = userDoc.data();

    if (userData.role !== "admin") {
        throw new functions.https.HttpsError("permission-denied", "El usuario no tiene permisos de administrador.");
    }

    // 2. Validación de Datos de Entrada
    const { employeeId, docType, fileUrl } = data;
    if (!employeeId || !docType || !fileUrl) {
        throw new functions.https.HttpsError("invalid-argument", "Faltan datos (employeeId, docType, fileUrl).");
    }

    // 3. Lógica de Actualización
    try {
        const employeeDocRef = admin.firestore().collection("users").doc(employeeId);

        // Usamos notación de punto para actualizar un campo dentro de un mapa.
        // Esto crea el mapa 'documentos' si no existe.
        const updatePayload = {
            [`documentos.${docType}`]: fileUrl
        };

        await employeeDocRef.update(updatePayload);

        return { success: true, message: `Documento '${docType}' actualizado para el empleado ${employeeId}.` };
    } catch (error) {
        functions.logger.error(`Error al actualizar documento para ${employeeId}:`, error);
        throw new functions.https.HttpsError("internal", "No se pudo actualizar el documento del empleado.");
    }
});
