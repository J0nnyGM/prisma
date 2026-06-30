// js/firebase-config.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-storage.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-functions.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-analytics.js";

const firebaseConfig = {
    apiKey: "AIzaSyAOeIv-PnETZIs5NFrsxsBnqf2_Gt6hbKM",
    authDomain: "prismacolorsas.firebaseapp.com",
    storageBucket: "prismacolorsas.firebasestorage.app",
    projectId: "prismacolorsas",
    messagingSenderId: "907757501037",
    appId: "1:907757501037:web:ab61eb771e12add9a29d64",
    measurementId: "G-T2RKG90GC5"
};

let app, auth, db, storage, functions, analytics;

try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    storage = getStorage(app);
    functions = getFunctions(app, 'us-central1');
    analytics = getAnalytics(app);

    // Activación de Caché Local Multi-pestaña para Firestore
    db = initializeFirestore(app, {
        localCache: persistentLocalCache({
            tabManager: persistentMultipleTabManager()
        })
    });
} catch (e) {
    console.error("Error al inicializar Firebase.", e);
    document.body.innerHTML = `<h1>Error Crítico: No se pudo inicializar la aplicación.</h1>`;
}

export { app, auth, db, storage, functions, analytics, httpsCallable };
