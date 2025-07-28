import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import { getFunctions } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";

const firebaseConfig = {
    apiKey: "AIzaSyAOeIv-PnETZIs5NFrsxsBnqf2_Gt6hbKM",
    authDomain: "prismacolorsas.firebaseapp.com",
    storageBucket: "prismacolorsas.firebasestorage.app",
    projectId: "prismacolorsas",
    messagingSenderId: "907757501037",
    appId: "1:907757501037:web:ab61eb771e12add9a29d64",
    measurementId: "G-T2RKG90GC5"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);
const functions = getFunctions(app, 'us-central1');

export { auth, db, storage, functions };
