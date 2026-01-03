const { onRequest, onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const axios = require("axios");
const logger = require("firebase-functions/logger");

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN?.replace(/['"\s]/g, '');
const PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID?.replace(/['"\s]/g, '');
const VERIFY_TOKEN = "PRISMA_COLOR_SECRET_TOKEN";

// Función para normalizar números a 10 dígitos (Formato Colombia)
function normalizarTelefono(phone) {
    let p = phone.replace(/\D/g, '');
    if (p.startsWith('57') && p.length === 12) {
        return p.substring(2);
    }
    return p;
}

exports.whatsappWebhook = onRequest(async (req, res) => {
    const db = admin.firestore();

    if (req.method === "GET") {
        const mode = req.query["hub.mode"];
        const token = req.query["hub.verify_token"];
        const challenge = req.query["hub.challenge"];
        if (mode === "subscribe" && token === VERIFY_TOKEN) return res.status(200).send(challenge);
        return res.sendStatus(403);
    }

    if (req.method === "POST") {
        const value = req.body.entry?.[0]?.changes?.[0]?.value;

        // 1. MANEJO DE ESTADOS
        if (value?.statuses) {
            const status = value.statuses[0];
            const msgId = status.id;
            const statusType = status.status; // 'delivered' o 'read'
            const phone = normalizarTelefono(status.recipient_id);

            try {
                const msgRef = db.collection("chats").doc(phone).collection("mensajes").doc(msgId);

                // En lugar de verificar si existe, usamos set con merge: true
                // Esto garantiza que si el estado llega antes que el mensaje, se guarde igual
                await msgRef.set({
                    status: statusType,
                    fechaEstado: admin.firestore.Timestamp.now()
                }, { merge: true });

                logger.info(`Estado ${statusType} procesado para ${msgId}`);
            } catch (e) {
                logger.error("Error en estado:", e.message);
            }
            return res.sendStatus(200);
        }

        // 2. RECEPCIÓN DE MENSAJES
        if (value?.messages) {
            const message = value.messages[0];
            const from = normalizarTelefono(message.from);
            const wa_id = message.id;

            // REFERENCIAS
            const chatRef = db.collection("chats").doc(from); // El cliente
            const msgRef = chatRef.collection("mensajes").doc(wa_id); // El mensaje específico

            const doc = await msgRef.get();

            if (!doc.exists) {
                let msgData = {
                    telefono: from,
                    fecha: admin.firestore.Timestamp.now(), // Usar timestamp oficial
                    leido: false,
                    tipo: "entrante",
                    wa_id: wa_id,
                    mimeType: message.type,
                    contenido: message.type === "text" ? message.text.body : `[${message.type}]`
                };

                // Procesar multimedia (Lógica de Storage que ya tenemos...)
                if (["image", "audio"].includes(message.type)) {
                    const mediaId = message[message.type].id;
                    try {
                        const response = await axios.get(`https://graph.facebook.com/v21.0/${mediaId}`, {
                            headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` }
                        });

                        const mediaResponse = await axios.get(response.data.url, {
                            headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
                            responseType: 'arraybuffer'
                        });

                        const bucket = admin.storage().bucket(); // Usa el bucket por defecto
                        const fileName = `whatsapp_media/${wa_id}`;
                        const file = bucket.file(fileName);

                        // Guardamos con metadata de cache para que el navegador no sufra
                        await file.save(Buffer.from(mediaResponse.data), {
                            metadata: {
                                contentType: message[message.type].mime_type,
                                cacheControl: 'public, max-age=31536000'
                            }
                        });

                        // OPCIÓN PROFESIONAL: Hacer el archivo público directamente (lectura)
                        // Esto evita usar Signed URLs que pueden fallar por permisos de IAM
                        await file.makePublic();

                        // La URL pública estándar de Google Cloud Storage
                        msgData.mediaUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;
                        msgData.contenido = message.type === "image" ? "[Imagen]" : "[Audio]";

                    } catch (e) {
                        logger.error("Error en multimedia:", e.message);
                        msgData.contenido = "[Error al procesar archivo]";
                    }
                }

                // --- OPERACIÓN ATÓMICA (Batch) ---
                const batch = db.batch();

                // A. Guardamos el mensaje en el hilo del cliente
                batch.set(msgRef, msgData);

                // B. Actualizamos el "Resumen" del chat para la lista del CRM
                batch.set(chatRef, {
                    ultimoMensaje: msgData.contenido,
                    fechaUltimo: msgData.fecha,
                    noLeidos: admin.firestore.FieldValue.increment(1),
                    telefono: from
                }, { merge: true });

                await batch.commit();
            }
        }
        return res.sendStatus(200);
    }
});

exports.sendWhatsAppMessage = onCall(async (request) => {
    // 1. Verificación de seguridad
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "Debes estar autenticado para enviar mensajes.");
    }

    const db = admin.firestore();
    const { telefono, mensaje } = request.data;

    // Normalizamos el teléfono para asegurar que usamos el ID de 10 dígitos en nuestra DB
    const phoneId = normalizarTelefono(telefono);
    const url = `https://graph.facebook.com/v19.0/${PHONE_ID}/messages`;

    try {
        // 2. Envío a la API de WhatsApp (usamos el prefijo 57 para el envío real)
        const response = await axios.post(url, {
            messaging_product: "whatsapp",
            to: `57${phoneId}`,
            type: "text",
            text: { body: mensaje }
        }, {
            headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` }
        });

        const wa_id = response.data.messages[0].id;
        const timestamp = admin.firestore.Timestamp.now();

        // 3. Referencias para la nueva estructura
        const chatRef = db.collection("chats").doc(phoneId);
        const msgRef = chatRef.collection("mensajes").doc(wa_id);

        // 4. Operación Atómica (Batch) para mantener la consistencia
        const batch = db.batch();

        // Guardamos el mensaje saliente en la subcolección
        batch.set(msgRef, {
            telefono: phoneId,
            contenido: mensaje,
            fecha: timestamp,
            tipo: "saliente",
            wa_id: wa_id,
            status: "sent",
            mimeType: "text"
        });

        // Actualizamos el resumen del chat (Colección principal)
        batch.set(chatRef, {
            ultimoMensaje: mensaje,
            fechaUltimo: timestamp,
            noLeidos: 0, // Como el administrador respondió, no hay mensajes pendientes por leer de este lado
            telefono: phoneId
        }, { merge: true });

        await batch.commit();

        return { success: true, wa_id: wa_id };

    } catch (e) {
        logger.error("Error enviando WhatsApp:", e.response?.data || e.message);
        throw new HttpsError("internal", e.response?.data?.error?.message || "Error al procesar el envío.");
    }
});