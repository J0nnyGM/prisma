const admin = require("firebase-admin");
const serviceAccount = require("./serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function run() {
  const phone = '3134303496';
  console.log(`Consultando mensajes del chat de William Gutierrez (${phone})...`);
  const msgsSnap = await db.collection("chats").doc(phone).collection("mensajes").orderBy("fecha", "desc").limit(10).get();
  msgsSnap.forEach(doc => {
    console.log(`Mensaje ID: ${doc.id}, Data:`, doc.data());
  });
}

run().catch(console.error);
