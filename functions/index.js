/**
 * Este es el código para tus Firebase Functions.
 * Debes desplegarlo usando Firebase CLI.
 */

const functions = require("firebase-functions");
const admin = require("firebase-admin");
const sgMail = require("@sendgrid/mail");
const {jsPDF} = require("jspdf");
require("jspdf-autotable");

// Inicializar Firebase Admin SDK
admin.initializeApp();

// Configurar SendGrid
const SENDGRID_API_KEY = functions.config().sendgrid.key;
const FROM_EMAIL = functions.config().sendgrid.from_email;
sgMail.setApiKey(SENDGRID_API_KEY);

const BUCKET_NAME = "prismacolorsas.firebasestorage.app";

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
  }).format(value);
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
  doc.text("REMISION DE SERVICIO", 105, 20, {align: "center"});

  // Marca de agua "ANULADA"
  if (remision.estado === "Anulada") {
    doc.setFontSize(60);
    doc.setTextColor(255, 0, 0);
    doc.text("ANULADA", 105, 140, null, 45);
    doc.setTextColor(0, 0, 0);
  }

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text("Prismacolor S.A.S.", 105, 28, {align: "center"});
  const contactInfo = "NIT: 900.123.456-7 | Tel: 300 123 4567";
  doc.text(contactInfo, 105, 33, {align: "center"});

  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  const remisionNum = `Remisión N°: ${remision.numeroRemision}`;
  doc.text(remisionNum, 190, 45, {align: "right"});

  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text("Cliente:", 20, 55);
  doc.setFont("helvetica", "normal");
  doc.text(remision.clienteNombre, 40, 55);
  if (!isForPlanta) {
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
    headStyles: {fillColor: [22, 160, 133]},
  });

  const finalY = doc.lastAutoTable.finalY;

  if (!isForPlanta) {
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text("Subtotal:", 130, finalY + 10);
    doc.text("IVA (19%):", 130, finalY + 17);
    doc.text("TOTAL:", 130, finalY + 24);

    doc.setFont("helvetica", "normal");
    doc.text(formatCurrency(remision.subtotal), 190, finalY + 10, {
      align: "right",
    });
    doc.text(formatCurrency(remision.valorIVA), 190, finalY + 17, {
      align: "right",
    });
    doc.setFont("helvetica", "bold");
    doc.text(formatCurrency(remision.valorTotal), 190, finalY + 24, {
      align: "right",
    });
    doc.setFontSize(10);
    doc.text(`Forma de Pago: ${remision.formaPago}`, 20, finalY + 35);
    doc.text(`Estado: ${remision.estado}`, 20, finalY + 42);
  }

  doc.setLineCap(2);
  doc.line(20, 270, 190, 270);
  doc.text("Gracias por su confianza.", 105, 275, {align: "center"});

  return Buffer.from(doc.output("arraybuffer"));
}

exports.onRemisionCreate = functions.region("us-central1").firestore
    .document("remisiones/{remisionId}")
    .onCreate(async (snap, context) => {
      const remisionData = snap.data();
      const remisionId = context.params.remisionId;
      const log = (message) => {
        functions.logger.log(`[${remisionId}] ${message}`);
      };
      log("Iniciando procesamiento de nueva remisión.");

      try {
        const pdfBuffer = generarPDF(remisionData, false);
        log("PDF de cliente generado en memoria.");
        const pdfPlantaBuffer = generarPDF(remisionData, true);
        log("PDF de planta generado en memoria.");

        const bucket = admin.storage().bucket(BUCKET_NAME);
        
        // Guardar PDF de cliente
        const filePath = `remisiones/${remisionData.numeroRemision}.pdf`;
        const file = bucket.file(filePath);
        await file.save(pdfBuffer, {metadata: {contentType: "application/pdf"}});
        log(`PDF de cliente guardado en Storage en: ${filePath}`);
        
        // Guardar PDF de planta
        const filePathPlanta = `remisiones/planta-${remisionData.numeroRemision}.pdf`;
        const filePlanta = bucket.file(filePathPlanta);
        await filePlanta.save(pdfPlantaBuffer, {metadata: {contentType: "application/pdf"}});
        log(`PDF de planta guardado en Storage en: ${filePathPlanta}`);

        const [url] = await file.getSignedUrl({
          action: "read",
          expires: "03-09-2491",
        });
        const [urlPlanta] = await filePlanta.getSignedUrl({
          action: "read",
          expires: "03-09-2491",
        });
        log("URLs públicas de PDFs obtenidas.");

        const msg = {
          to: remisionData.clienteEmail,
          from: FROM_EMAIL,
          subject: `Confirmación de Remisión N° ${remisionData.numeroRemision}`,
          html: `<p>Hola ${remisionData.clienteNombre},</p>
          <p>Hemos recibido tu orden y adjuntamos la remisión de servicio.</p>
          <p>El estado actual es: <strong>${remisionData.estado}</strong>.</p>
          <p>Gracias por confiar en nosotros.</p>
          <p><strong>Prismacolor S.A.S.</strong></p>`,
          attachments: [{
            content: pdfBuffer.toString("base64"),
            filename: `Remision-${remisionData.numeroRemision}.pdf`,
            type: "application/pdf",
            disposition: "attachment",
          }],
        };
        await sgMail.send(msg);
        log(`Correo enviado exitosamente a ${remisionData.clienteEmail}.`);

        return snap.ref.update({pdfUrl: url, pdfPlantaUrl: urlPlanta, emailStatus: "sent"});
      } catch (error) {
        functions.logger.error(`[${remisionId}] Error:`, error);
        return snap.ref.update({emailStatus: "error"});
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
          log("PDF de anulación generado.");

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
          log("Error al enviar correo de anulación:", error);
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
          await file.save(pdfBuffer, {metadata: {contentType: "application/pdf"}});
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

      return null;
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
        if (!remisionDoc.exists) {
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
        return snap.ref.update({status: "error", error: error.message});
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
