const admin = require("firebase-admin");
const serviceAccount = require("./serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function run() {
  console.log("Checking documents in prestamos collection...");
  const prestamosSnap = await db.collection("prestamos").get();
  console.log(`Found ${prestamosSnap.size} loans in prestamos collection.`);
  
  prestamosSnap.forEach(doc => {
    const data = doc.data();
    console.log(`ID: ${doc.id}, Employee: ${data.employeeName} (ID: ${data.employeeId}), Status: ${data.status}, Amount: ${data.amount}, Balance: ${data.balance}, Date: ${data.aprobadoDate || data.requestDate}`);
  });
}

run().catch(console.error);
