import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, updateEmail } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, getFirestore, collection, doc, setDoc, getDoc, getDocs, query, orderBy, onSnapshot, deleteDoc, updateDoc, increment, addDoc, runTransaction, arrayUnion, where, limit, startAfter } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";
import { getAnalytics, logEvent } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-analytics.js";

// --- INICIALIZACIÓN Y CONFIGURACIÓN ---
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

    // Activación de Caché Moderna
    db = initializeFirestore(app, {
        localCache: persistentLocalCache({
            tabManager: persistentMultipleTabManager()
        })
    });
} catch (e) {
    console.error("Error al inicializar Firebase.", e);
    document.body.innerHTML = `<h1>Error Crítico: No se pudo inicializar la aplicación.</h1>`;
}
// --- VISTAS Y ESTADO GLOBAL ---

let globalesSaldos = {
    Efectivo: 0,
    Nequi: 0,
    Davivienda: 0
};


let paymentModalUnsubscribe = null; // Variable para apagar el escucha del modal

let lastGastoDoc = null;
let cargandoMasGastos = false;


let lastRemisionDoc = null; // Almacena el último documento cargado para la paginación
let cargandoMasRemisiones = false; // Evita múltiples clics accidentales

let remisionesFacturadasHistorial = []; // Para la pestaña "Realizadas"
let lastFacturadaDoc = null; // Para paginar las realizadas
let cargandoMasFacturadas = false;

const authView = document.getElementById('auth-view');
const appView = document.getElementById('app-view');
const deniedView = document.getElementById('denied-view');
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
let currentUser = null;
let currentUserData = null;
let allItems = [], allColores = [], allClientes = [], allProveedores = [], allGastos = [], allRemisiones = [], allUsers = [], allPendingLoans = [], profitLossChart = null;

let remisionesPendientesFactura = []; // Solo para el módulo de Facturación
let remisionesCartera = [];           // Solo para el Dashboard/Cartera
let facturacionUnsubscribe = null;
let carteraUnsubscribe = null;

let dynamicElementCounter = 0;
let isRegistering = false; // <-- Variable de "cerradura" para el registro
const ESTADOS_REMISION = ['Recibido', 'En Proceso', 'Procesado', 'Entregado'];
const ALL_MODULES = ['remisiones', 'facturacion', 'clientes', 'items', 'colores', 'gastos', 'proveedores', 'prestamos', 'empleados', 'mensajes']; // Añadido 'mensajes'
const RRHH_DOCUMENT_TYPES = [
    { id: 'contrato', name: 'Contrato' }, { id: 'hojaDeVida', name: 'Hoja de Vida' }, { id: 'examenMedico', name: 'Examen Médico' }, { id: 'cedula', name: 'Cédula (PDF)' }, { id: 'certificadoARL', name: 'Certificado ARL' }, { id: 'certificadoEPS', name: 'Certificado EPS' }, { id: 'certificadoAFP', name: 'Certificado AFP' }, { id: 'cartaRetiro', name: 'Carta de renuncia o despido' }, { id: 'liquidacionDoc', name: 'Liquidación' },
];


// --- MANEJO DE AUTENTICACIÓN Y VISTAS ---
let activeListeners = [];

function unsubscribeAllListeners() {
    activeListeners.forEach(unsubscribe => unsubscribe());
    activeListeners = [];
}

onAuthStateChanged(auth, async (user) => {
    unsubscribeAllListeners();
    if (user) {
        currentUser = user;
        const userDoc = await getDoc(doc(db, "users", user.uid));
        if (userDoc.exists()) {
            currentUserData = { id: user.uid, ...userDoc.data() };
            if (currentUserData.status === 'active') {
                document.getElementById('user-info').textContent = `Usuario: ${currentUserData.nombre} (${currentUserData.role})`;
                // Registrar evento de inicio de sesión en Analytics
                logEvent(analytics, 'login', {
                    method: 'email',
                    user_role: currentUserData.role // Puedes añadir datos personalizados
                });
                authView.classList.add('hidden');
                deniedView.classList.add('hidden');
                appView.classList.remove('hidden');
                startApp();
            } else {
                let message = "Tu cuenta está pendiente de aprobación por un administrador.";
                if (currentUserData.status === 'inactive') message = "Tu cuenta ha sido desactivada temporalmente.";
                if (currentUserData.status === 'archived') message = "Tu cuenta ha sido archivada y no puedes acceder.";
                document.getElementById('denied-message').textContent = message;
                authView.classList.add('hidden');
                appView.classList.add('hidden');
                deniedView.classList.remove('hidden');
            }
        } else {
            signOut(auth);
        }
    } else {
        currentUser = null;
        currentUserData = null;
        appView.classList.add('hidden');
        deniedView.classList.add('hidden');
        authView.classList.remove('hidden');
        isAppInitialized = false;
    }
});

// Listeners para los elementos que siempre están presentes
document.getElementById('logout-denied-user').addEventListener('click', () => signOut(auth));
document.getElementById('show-register-link').addEventListener('click', (e) => { e.preventDefault(); loginForm.classList.add('hidden'); registerForm.classList.remove('hidden'); });
document.getElementById('show-login-link').addEventListener('click', (e) => { e.preventDefault(); registerForm.classList.add('hidden'); loginForm.classList.remove('hidden'); });
loginForm.addEventListener('submit', handleLoginSubmit);
registerForm.addEventListener('submit', handleRegisterSubmit);


// --- LÓGICA DE INICIALIZACIÓN DE LA APP ---
let isAppInitialized = false;

// 1. Función startApp: Mantiene el flujo lógico sin cambios de IDs
function startApp() {
    if (isAppInitialized) return;

    // Crear la estructura HTML
    loadViewTemplates();

    // Actualizar visibilidad según el rol
    updateUIVisibility(currentUserData);

    // Configurar los listeners de eventos (clicks, submits)
    setupEventListeners();

    setupWhatsAppEvents(); // <--- ESTO SOLUCIONA EL ERROR DE LA LÍNEA 162

    // ÚNICA CARGA DE DATOS: Aquí es donde se activan los onSnapshot
    loadAllData();

    loadSaldosBase();

    listenGlobalSaldos(); // <--- AGREGA ESTA LÍNEA AQUÍ

    // Inicializar buscadores
    setupSearchInputs();

    setupMobileInfoToggle();

    isAppInitialized = true;
}

function loadAllData() {
    // 1. Carga de Catálogos Maestros (Tiempo Real)
    activeListeners.push(loadClientes());
    activeListeners.push(loadProveedores());
    activeListeners.push(loadItems());
    activeListeners.push(loadColores());

    // 2. Historial de Remisiones (Tiempo Real)
    // Invocamos la función. Ella misma gestiona el remisionesSnapUnsubscribe interno.
    loadRemisiones();
    // Agregamos una función anónima para limpiar el listener del historial al cerrar sesión
    activeListeners.push(() => {
        if (remisionesSnapUnsubscribe) remisionesSnapUnsubscribe();
    });

    // 3. Consultas especializadas (Facturación y Cartera)
    activeListeners.push(loadRemisionesFacturacion());
    activeListeners.push(loadRemisionesCartera());

    // 4. Módulo de Mensajería / CRM (Tiempo Real)
    activeListeners.push(listenChatList());

    // 5. Gastos (Paginación - Consulta única inicial)
    // Nota: loadGastos suele ser getDocs para no saturar, pero se llama aquí
    loadGastos();

    // 6. Funciones exclusivas para Administradores
    if (currentUserData && currentUserData.role === 'admin') {
        activeListeners.push(loadEmpleados());
        activeListeners.push(loadAllLoanRequests());
    }
}

// 2. Función loadViewTemplates corregida (Se eliminó la carga de datos al final)
function loadViewTemplates() {
    registerForm.innerHTML = `
        <h2 class="text-2xl font-bold text-center mb-6">Crear Cuenta</h2>
        <div class="space-y-4">
            <input type="text" id="register-name" placeholder="Nombre Completo" class="w-full p-3 border border-gray-300 rounded-lg" required>
            <input type="text" id="register-cedula" placeholder="Cédula" class="w-full p-3 border border-gray-300 rounded-lg" required>
            <input type="tel" id="register-phone" placeholder="Celular" class="w-full p-3 border border-gray-300 rounded-lg" required>
            <input type="text" id="register-address" placeholder="Dirección" class="w-full p-3 border border-gray-300 rounded-lg">
            <input type="email" id="register-email" placeholder="Correo Electrónico" class="w-full p-3 border border-gray-300 rounded-lg" required>
            <input type="password" id="register-password" placeholder="Contraseña (mín. 6 caracteres)" class="w-full p-3 border border-gray-300 rounded-lg" required>
            <div><label for="register-dob" class="block text-sm font-medium text-gray-700">Fecha de Nacimiento</label><input type="date" id="register-dob" class="w-full p-3 border border-gray-300 rounded-lg mt-1" required></div>
            
            <div class="flex items-center space-x-2">
                <input type="checkbox" id="register-politica" class="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" required>
                <label for="register-politica" class="text-sm text-gray-600">
                    Acepto la <a href="#" id="show-policy-link" class="font-semibold text-indigo-600 hover:underline">Política de Tratamiento de Datos</a>.
                </label>
            </div>

            <button type="submit" class="w-full bg-blue-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-blue-700">Registrarse</button>
        </div>
        <p class="text-center mt-4 text-sm">¿Ya tienes una cuenta? <a href="#" id="show-login-link-register" class="font-semibold text-indigo-600 hover:underline">Inicia sesión</a></p>
    `;

    document.getElementById('view-remisiones').innerHTML = `<div class="grid grid-cols-1 lg:grid-cols-3 gap-8 max-w-6xl mx-auto"><div id="remision-form-container" class="lg:col-span-1 bg-white p-6 rounded-xl shadow-md"><h2 class="text-xl font-semibold mb-4">Nueva Remisión</h2><form id="remision-form" class="space-y-4"><div class="relative"><input type="text" id="cliente-search-input" autocomplete="off" placeholder="Buscar y seleccionar cliente..." class="w-full p-3 border border-gray-300 rounded-lg" required><input type="hidden" id="cliente-id-hidden" name="clienteId"><div id="cliente-search-results" class="search-results hidden"></div></div><div><label for="fecha-recibido" class="block text-sm font-medium text-gray-700">Fecha Recibido</label><input type="date" id="fecha-recibido" class="w-full p-3 border border-gray-300 rounded-lg mt-1 bg-gray-100" readonly></div><div class="border-t border-b border-gray-200 py-4"><h3 class="text-lg font-semibold mb-2">Ítems de la Remisión</h3><div id="items-container" class="space-y-4"></div><button type="button" id="add-item-btn" class="mt-4 w-full bg-gray-200 text-gray-700 font-semibold py-2 px-4 rounded-lg hover:bg-gray-300 transition-colors">+ Añadir Ítem</button></div><select id="forma-pago" class="w-full p-3 border border-gray-300 rounded-lg bg-white" required><option value="" disabled selected>Forma de Pago</option><option value="Pendiente">Pendiente</option><option value="Efectivo">Efectivo</option><option value="Nequi">Nequi</option><option value="Davivienda">Davivienda</option></select><div class="bg-gray-50 p-4 rounded-lg space-y-2"><div class="flex justify-between items-center"><span class="font-medium">Subtotal:</span><span id="subtotal" class="font-bold text-lg">$ 0</span></div><div class="flex justify-between items-center"><label for="incluir-iva" class="flex items-center space-x-2 cursor-pointer"><input type="checkbox" id="incluir-iva" class="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"><span>Incluir IVA (19%)</span></label><span id="valor-iva" class="font-medium text-gray-600">$ 0</span></div><hr><div class="flex justify-between items-center text-xl"><span class="font-bold">TOTAL:</span><span id="valor-total" class="font-bold text-indigo-600">$ 0</span></div></div>
    <div><label for="remision-observaciones" class="block text-sm font-medium text-gray-700">Observaciones</label><textarea id="remision-observaciones" placeholder="Añadir notas especiales para el cliente o para planta..." class="w-full p-3 border border-gray-300 rounded-lg mt-1" rows="3"></textarea></div>
    <button type="submit" class="w-full bg-indigo-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-indigo-700 transition-colors">Guardar Remisión</button></form></div><div id="remisiones-list-container" class="lg:col-span-2 bg-white p-6 rounded-xl shadow-md"><div class="flex flex-col sm:flex-row justify-between sm:items-center mb-4 flex-wrap gap-4"><h2 class="text-xl font-semibold">Historial de Remisiones</h2><div class="flex items-center gap-2 flex-wrap w-full"><select id="filter-remisiones-month" class="p-2 border rounded-lg bg-white"></select><select id="filter-remisiones-year" class="p-2 border rounded-lg bg-white"></select><input type="search" id="search-remisiones" placeholder="Buscar..." class="p-2 border rounded-lg flex-grow"></div></div><div id="remisiones-list" class="space-y-3"></div></div></div>`;

    document.getElementById('view-facturacion').innerHTML = `<div class="bg-white p-6 rounded-xl shadow-md max-w-6xl mx-auto"><h2 class="text-2xl font-semibold mb-4">Gestión de Facturación</h2><div class="border-b border-gray-200 mb-6"><nav id="facturacion-nav" class="-mb-px flex space-x-6"><button id="tab-pendientes" class="dashboard-tab-btn active py-3 px-1 font-semibold">Pendientes</button><button id="tab-realizadas" class="dashboard-tab-btn py-3 px-1 font-semibold">Realizadas</button></nav></div><div id="view-pendientes"><h3 class="text-xl font-semibold text-gray-800 mb-4">Remisiones Pendientes de Facturar</h3><div id="facturacion-pendientes-list" class="space-y-3"></div></div><div id="view-realizadas" class="hidden"><h3 class="text-xl font-semibold text-gray-800 mb-4">Remisiones Facturadas</h3><div id="facturacion-realizadas-list" class="space-y-3"></div></div></div>`;
    document.getElementById('view-clientes').innerHTML = `<div class="grid grid-cols-1 lg:grid-cols-3 gap-8 max-w-6xl mx-auto"><div class="lg:col-span-1 bg-white p-6 rounded-xl shadow-md"><h2 class="text-xl font-semibold mb-4">Añadir Cliente</h2><form id="add-cliente-form" class="space-y-4"><input type="text" id="nuevo-cliente-nombre" placeholder="Nombre Completo" class="w-full p-3 border border-gray-300 rounded-lg" required><input type="email" id="nuevo-cliente-email" placeholder="Correo" class="w-full p-3 border border-gray-300 rounded-lg" required><input type="tel" id="nuevo-cliente-telefono1" placeholder="Teléfono 1" class="w-full p-3 border border-gray-300 rounded-lg" required><input type="tel" id="nuevo-cliente-telefono2" placeholder="Teléfono 2 (Opcional)" class="w-full p-3 border border-gray-300 rounded-lg"><input type="text" id="nuevo-cliente-nit" placeholder="NIT (Opcional)" class="w-full p-3 border border-gray-300 rounded-lg"><button type="submit" class="w-full bg-blue-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-blue-700">Registrar</button></form></div><div class="lg:col-span-2 bg-white p-6 rounded-xl shadow-md"><div class="flex justify-between items-center mb-4"><h2 class="text-xl font-semibold">Clientes</h2><input type="search" id="search-clientes" placeholder="Buscar..." class="p-2 border rounded-lg"></div><div id="clientes-list" class="space-y-3"></div></div></div>`;
    document.getElementById('view-proveedores').innerHTML = `<div class="grid grid-cols-1 lg:grid-cols-3 gap-8 max-w-6xl mx-auto"><div class="lg:col-span-1 bg-white p-6 rounded-xl shadow-md"><h2 class="text-xl font-semibold mb-4">Añadir Proveedor</h2><form id="add-proveedor-form" class="space-y-4"><input type="text" id="nuevo-proveedor-nombre" placeholder="Nombre del Proveedor" class="w-full p-3 border border-gray-300 rounded-lg" required><input type="text" id="nuevo-proveedor-contacto" placeholder="Nombre de Contacto" class="w-full p-3 border border-gray-300 rounded-lg"><input type="tel" id="nuevo-proveedor-telefono" placeholder="Teléfono" class="w-full p-3 border border-gray-300 rounded-lg"><input type="email" id="nuevo-proveedor-email" placeholder="Correo" class="w-full p-3 border border-gray-300 rounded-lg"><button type="submit" class="w-full bg-teal-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-teal-700">Registrar</button></form></div><div class="lg:col-span-2 bg-white p-6 rounded-xl shadow-md"><div class="flex justify-between items-center mb-4"><h2 class="text-xl font-semibold">Proveedores</h2><input type="search" id="search-proveedores" placeholder="Buscar..." class="p-2 border rounded-lg"></div><div id="proveedores-list" class="space-y-3"></div></div></div>`;
    document.getElementById('view-items').innerHTML = `<div class="grid grid-cols-1 lg:grid-cols-3 gap-8 max-w-6xl mx-auto"><div class="lg:col-span-1 bg-white p-6 rounded-xl shadow-md"><h2 class="text-xl font-semibold mb-4">Añadir Ítem</h2><form id="add-item-form" class="space-y-4"><input type="text" id="nuevo-item-ref" placeholder="Referencia (ej. P-001)" class="w-full p-3 border border-gray-300 rounded-lg" required><input type="text" id="nuevo-item-desc" placeholder="Descripción del Ítem o Servicio" class="w-full p-3 border border-gray-300 rounded-lg" required><button type="submit" class="w-full bg-green-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-green-700">Registrar</button></form></div><div class="lg:col-span-2 bg-white p-6 rounded-xl shadow-md"><div class="flex justify-between items-center mb-4"><h2 class="text-xl font-semibold">Catálogo de Ítems</h2><input type="search" id="search-items" placeholder="Buscar..." class="p-2 border rounded-lg"></div><div id="items-list" class="space-y-3"></div></div></div>`;
    document.getElementById('view-colores').innerHTML = `<div class="grid grid-cols-1 lg:grid-cols-3 gap-8 max-w-6xl mx-auto"><div class="lg:col-span-1 bg-white p-6 rounded-xl shadow-md"><h2 class="text-xl font-semibold mb-4">Añadir Color</h2><form id="add-color-form" class="space-y-4"><input type="text" id="nuevo-color-nombre" placeholder="Nombre del Color (ej. RAL 7016)" class="w-full p-3 border border-gray-300 rounded-lg" required><button type="submit" class="w-full bg-purple-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-purple-700">Registrar</button></form></div><div class="lg:col-span-2 bg-white p-6 rounded-xl shadow-md"><div class="flex justify-between items-center mb-4"><h2 class="text-xl font-semibold">Catálogo de Colores</h2><input type="search" id="search-colores" placeholder="Buscar..." class="p-2 border rounded-lg"></div><div id="colores-list" class="space-y-3"></div></div></div>`;
    document.getElementById('view-gastos').innerHTML = `<div class="grid grid-cols-1 lg:grid-cols-3 gap-8 max-w-6xl mx-auto"><div class="lg:col-span-1 bg-white p-6 rounded-xl shadow-md"><h2 class="text-xl font-semibold mb-4">Nuevo Gasto</h2><form id="add-gasto-form" class="space-y-4"><div><label for="gasto-fecha">Fecha</label><input type="date" id="gasto-fecha" class="w-full p-3 border border-gray-300 rounded-lg mt-1" required></div><div class="relative"><label for="proveedor-search-input">Proveedor</label><input type="text" id="proveedor-search-input" autocomplete="off" placeholder="Buscar..." class="w-full p-3 border border-gray-300 rounded-lg mt-1" required><input type="hidden" id="proveedor-id-hidden" name="proveedorId"><div id="proveedor-search-results" class="search-results hidden"></div></div><input type="text" id="gasto-factura" placeholder="N° de Factura (Opcional)" class="w-full p-3 border border-gray-300 rounded-lg"><input type="text" id="gasto-valor-total" inputmode="numeric" placeholder="Valor Total" class="w-full p-3 border border-gray-300 rounded-lg" required><label class="flex items-center space-x-2"><input type="checkbox" id="gasto-iva" class="h-4 w-4 rounded border-gray-300"><span>IVA del 19% incluido</span></label><div><label for="gasto-fuente">Fuente del Pago</label><select id="gasto-fuente" class="w-full p-3 border border-gray-300 rounded-lg mt-1 bg-white" required><option>Efectivo</option><option>Nequi</option><option>Davivienda</option></select></div><button type="submit" class="w-full bg-orange-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-orange-700">Registrar</button></form></div><div class="lg:col-span-2 bg-white p-6 rounded-xl shadow-md"><div class="flex flex-col sm:flex-row justify-between sm:items-center mb-4 gap-4"><h2 class="text-xl font-semibold flex-shrink-0">Historial de Gastos</h2><div class="flex flex-wrap items-center gap-2 w-full sm:w-auto justify-start sm:justify-end"><select id="filter-gastos-month" class="p-2 border rounded-lg bg-white"></select><select id="filter-gastos-year" class="p-2 border rounded-lg bg-white"></select><input type="search" id="search-gastos" placeholder="Buscar..." class="p-2 border rounded-lg flex-grow sm:flex-grow-0 sm:w-40"></div></div><div id="gastos-list" class="space-y-3"></div></div></div>`;
    document.getElementById('view-empleados').innerHTML = `<div class="bg-white p-6 rounded-xl shadow-md max-w-4xl mx-auto"><h2 class="text-xl font-semibold mb-4">Gestión de Empleados</h2><div id="empleados-list" class="space-y-3"></div></div>`;

    // NOTA: Se eliminó el bloque de 'activeListeners.push' que causaba la doble lectura de Firestore.
}


// **** FUNCIÓN CORREGIDA ****
// Reemplaza la función completa en js/app.js
function updateUIVisibility(userData) {
    if (!userData) return;
    const isAdmin = userData.role?.toLowerCase() === 'admin';

    // Muestra u oculta las pestañas de navegación
    ALL_MODULES.forEach(module => {
        const tab = document.getElementById(`tab-${module}`);
        if (tab) {
            const hasPermission = isAdmin || (userData.permissions && userData.permissions[module]);
            tab.classList.toggle('hidden', !hasPermission);
        }
    });

    // Muestra los botones correctos del encabezado según el rol
    document.getElementById('view-all-loans-btn').style.display = isAdmin ? 'block' : 'none';
    document.getElementById('summary-btn').style.display = isAdmin ? 'block' : 'none';
    document.getElementById('loan-request-btn').style.display = isAdmin ? 'none' : 'block';


    // Ajusta la vista de remisiones para el rol de planta
    const isPlanta = userData.role?.toLowerCase() === 'planta';
    const remisionFormContainer = document.getElementById('remision-form-container');
    const remisionListContainer = document.getElementById('remisiones-list-container');
    if (remisionFormContainer && remisionListContainer) {
        remisionFormContainer.style.display = isPlanta ? 'none' : '';
        remisionListContainer.classList.toggle('lg:col-span-3', isPlanta);
        remisionListContainer.classList.toggle('lg:col-span-2', !isPlanta);
    }
}


// --- LÓGICA DE LOGIN/REGISTRO/LOGOUT ---
document.getElementById('show-register-link').addEventListener('click', (e) => { e.preventDefault(); loginForm.classList.add('hidden'); registerForm.classList.remove('hidden'); });
document.getElementById('show-login-link').addEventListener('click', (e) => { e.preventDefault(); registerForm.classList.add('hidden'); loginForm.classList.remove('hidden'); });

loginForm.addEventListener('submit', handleLoginSubmit); // Asegúrate de tener la función handleLoginSubmit
registerForm.addEventListener('submit', handleRegisterSubmit); // Asegúrate de tener la función handleRegisterSubmit

function handleLoginSubmit(e) {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    signInWithEmailAndPassword(auth, email, password).catch(error => {
        console.error(error);
        showModalMessage("Error: " + error.message);
    });
}

async function handleRegisterSubmit(e) {
    e.preventDefault();
    if (isRegistering) return;

    isRegistering = true;
    const submitButton = e.target.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    submitButton.textContent = 'Registrando...';
    submitButton.classList.add('opacity-50', 'cursor-not-allowed');

    const politicaCheckbox = document.getElementById('register-politica');
    if (!politicaCheckbox.checked) {
        showModalMessage("Debes aceptar la Política de Tratamiento de Datos.");
        isRegistering = false;
        submitButton.disabled = false;
        submitButton.textContent = 'Registrarse';
        submitButton.classList.remove('opacity-50', 'cursor-not-allowed');
        return;
    }

    // --- INICIO DE LA CORRECCIÓN ---
    // Se capturan todos los valores del formulario
    const nombre = document.getElementById('register-name').value;
    const cedula = document.getElementById('register-cedula').value;
    const telefono = document.getElementById('register-phone').value;
    const direccion = document.getElementById('register-address').value;
    const email = document.getElementById('register-email').value;
    const password = document.getElementById('register-password').value;
    const dob = document.getElementById('register-dob').value;
    // --- FIN DE LA CORRECCIÓN ---

    showModalMessage("Registrando...", true);

    try {
        const role = 'planta';
        const status = 'pending';
        const permissions = {
            remisiones: true, prestamos: true,
            facturacion: false, clientes: false, items: false,
            colores: false, gastos: false, proveedores: false, empleados: false
        };

        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        // --- INICIO DE LA CORRECCIÓN ---
        // Se guardan todos los campos capturados en la base de datos
        await setDoc(doc(db, "users", user.uid), {
            nombre: nombre,
            cedula: cedula,
            telefono: telefono,
            direccion: direccion,
            email: email,
            dob: dob,
            role: role,
            status: status,
            permissions: permissions,
            creadoEn: new Date()
        });
        // --- FIN DE LA CORRECCIÓN ---

        hideModal();
        showModalMessage("¡Registro exitoso! Tu cuenta está pendiente de aprobación.", false, 5000);
        registerForm.reset();
        registerForm.classList.add('hidden');
        loginForm.classList.remove('hidden');

        await signOut(auth);

    } catch (error) {
        hideModal();
        console.error("Error de registro:", error);
        showModalMessage("Error de registro: " + error.message);
    } finally {
        isRegistering = false;
        submitButton.disabled = false;
        submitButton.textContent = 'Registrarse';
        submitButton.classList.remove('opacity-50', 'cursor-not-allowed');
    }
}

loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    signInWithEmailAndPassword(auth, email, password).catch(error => {
        console.error(error);
        showModalMessage("Error: " + error.message);
    });
});


// Corregimos la función de logout

document.getElementById('logout-btn').addEventListener('click', () => {
    unsubscribeAllListeners();
    signOut(auth);
});

function setupEventListeners() {
    // --- NAVEGACIÓN ---
    const tabs = { remisiones: document.getElementById('tab-remisiones'), facturacion: document.getElementById('tab-facturacion'), clientes: document.getElementById('tab-clientes'), items: document.getElementById('tab-items'), colores: document.getElementById('tab-colores'), gastos: document.getElementById('tab-gastos'), proveedores: document.getElementById('tab-proveedores'), empleados: document.getElementById('tab-empleados'), mensajes: document.getElementById('tab-mensajes') };
    const views = { remisiones: document.getElementById('view-remisiones'), facturacion: document.getElementById('view-facturacion'), clientes: document.getElementById('view-clientes'), items: document.getElementById('view-items'), colores: document.getElementById('view-colores'), gastos: document.getElementById('view-gastos'), proveedores: document.getElementById('view-proveedores'), empleados: document.getElementById('view-empleados'), mensajes: document.getElementById('view-mensajes') };
    Object.keys(tabs).forEach(key => { if (tabs[key]) tabs[key].addEventListener('click', () => switchView(key, tabs, views)) });

    // --- FACTURACIÓN TABS ---
    const facturacionPendientesTab = document.getElementById('tab-pendientes');
    const facturacionRealizadasTab = document.getElementById('tab-realizadas');
    if (facturacionPendientesTab) {
        facturacionPendientesTab.addEventListener('click', () => {
            facturacionPendientesTab.classList.add('active');
            facturacionRealizadasTab.classList.remove('active');
            document.getElementById('view-pendientes').classList.remove('hidden');
            document.getElementById('view-realizadas').classList.add('hidden');
        });
    }
    if (facturacionRealizadasTab) {
        facturacionRealizadasTab.addEventListener('click', () => {
            facturacionRealizadasTab.classList.add('active');
            facturacionPendientesTab.classList.remove('active');
            document.getElementById('view-realizadas').classList.remove('hidden');
            document.getElementById('view-pendientes').classList.add('hidden');
        });
    }

    // --- FORMULARIOS ---
    document.getElementById('add-color-form').addEventListener('submit', async (e) => { e.preventDefault(); const nuevoColor = { nombre: document.getElementById('nuevo-color-nombre').value, creadoEn: new Date() }; try { await addDoc(collection(db, "colores"), nuevoColor); e.target.reset(); showModalMessage("¡Color registrado!", false, 2000); } catch (error) { showModalMessage("Error al registrar color."); } });
    document.getElementById('add-item-form').addEventListener('submit', async (e) => { e.preventDefault(); const nuevoItem = { referencia: document.getElementById('nuevo-item-ref').value, descripcion: document.getElementById('nuevo-item-desc').value, creadoEn: new Date() }; try { await addDoc(collection(db, "items"), nuevoItem); e.target.reset(); showModalMessage("¡Ítem registrado!", false, 2000); } catch (error) { showModalMessage("Error al registrar ítem."); } });
    document.getElementById('add-cliente-form').addEventListener('submit', async (e) => { e.preventDefault(); const nuevoCliente = { nombre: document.getElementById('nuevo-cliente-nombre').value, email: document.getElementById('nuevo-cliente-email').value, telefono1: document.getElementById('nuevo-cliente-telefono1').value, telefono2: document.getElementById('nuevo-cliente-telefono2').value, nit: document.getElementById('nuevo-cliente-nit').value || '', creadoEn: new Date() }; try { await addDoc(collection(db, "clientes"), nuevoCliente); e.target.reset(); showModalMessage("¡Cliente registrado!", false, 2000); } catch (error) { showModalMessage("Error al registrar cliente."); } });
    document.getElementById('add-proveedor-form').addEventListener('submit', handleProveedorSubmit);
    document.getElementById('add-gasto-form').addEventListener('submit', handleGastoSubmit);
    document.getElementById('remision-form').addEventListener('submit', handleRemisionSubmit);

    // --- ACCIONES REMISIÓN ---
    document.getElementById('add-item-btn').addEventListener('click', () => {
        const itemsContainer = document.getElementById('items-container');
        if (itemsContainer) itemsContainer.appendChild(createItemElement());
    });
    if (document.getElementById('incluir-iva')) document.getElementById('incluir-iva').addEventListener('input', calcularTotales);

    // --- ENCABEZADO Y MODALES ---
    document.getElementById('summary-btn').addEventListener('click', showDashboardModal);
    document.getElementById('edit-profile-btn').addEventListener('click', showEditProfileModal);
    document.getElementById('loan-request-btn').addEventListener('click', showLoanRequestModal);
    document.getElementById('view-all-loans-btn').addEventListener('click', () => showAllLoansModal(allPendingLoans));
    document.getElementById('logout-btn').addEventListener('click', () => { unsubscribeAllListeners(); signOut(auth); });
    document.getElementById('show-policy-link').addEventListener('click', (e) => { e.preventDefault(); document.getElementById('policy-modal').classList.remove('hidden'); });
    document.getElementById('close-policy-modal').addEventListener('click', () => document.getElementById('policy-modal').classList.add('hidden'));
    document.getElementById('accept-policy-btn').addEventListener('click', () => document.getElementById('policy-modal').classList.add('hidden'));

    // --- EMPLEADOS ---
    const empleadosView = document.getElementById('view-empleados');
    if (empleadosView) {
        empleadosView.addEventListener('click', async (e) => {
            const target = e.target;
            if (target.classList.contains('user-status-btn')) {
                const uid = target.dataset.uid;
                const newStatus = target.dataset.status;
                if (confirm(`¿Cambiar estado a "${newStatus}"?`)) { await updateDoc(doc(db, "users", uid), { status: newStatus }); }
            }
            if (target.classList.contains('manage-user-btn')) { showAdminEditUserModal(JSON.parse(target.dataset.userJson)); }
        });
    }

    // --- BUSCADORES ---
    let searchTimeout;
    document.getElementById('search-remisiones').addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        const term = e.target.value.trim();
        searchTimeout = setTimeout(() => searchRemisionesGlobal(term), 500);
    });

    document.getElementById('search-clientes').addEventListener('input', renderClientes);
    document.getElementById('search-proveedores').addEventListener('input', renderProveedores);
    document.getElementById('search-items').addEventListener('input', renderItems);
    document.getElementById('search-colores').addEventListener('input', renderColores);
    document.getElementById('search-gastos').addEventListener('input', renderGastos);

    // --- FILTROS FECHA ---
    populateDateFilters('filter-remisiones');
    populateDateFilters('filter-gastos');

    // Manejador de filtros para Remisiones
    const handleRemisionFilter = () => {
        const month = document.getElementById('filter-remisiones-month').value;
        const year = document.getElementById('filter-remisiones-year').value;
        lastRemisionDoc = null;
        loadRemisiones(month, year, false);
    };
    document.getElementById('filter-remisiones-month').addEventListener('change', handleRemisionFilter);
    document.getElementById('filter-remisiones-year').addEventListener('change', handleRemisionFilter);

    // NUEVO: Manejador de filtros para Gastos (Idéntico a Remisiones)
    const handleGastoFilter = () => {
        const month = document.getElementById('filter-gastos-month').value;
        const year = document.getElementById('filter-gastos-year').value;
        lastGastoDoc = null; // Reiniciamos el puntero para la nueva consulta
        loadGastos(month, year, false);
    };
    document.getElementById('filter-gastos-month').addEventListener('change', handleGastoFilter);
    document.getElementById('filter-gastos-year').addEventListener('change', handleGastoFilter);

    // --- CONFIGURACIÓN INICIAL ---
    if (document.getElementById('fecha-recibido')) document.getElementById('fecha-recibido').value = new Date().toISOString().split('T')[0];

    // Formateo de moneda
    document.getElementById('view-gastos').addEventListener('focusout', (e) => { if (e.target.id === 'gasto-valor-total') formatCurrencyInput(e.target); });
    document.getElementById('view-gastos').addEventListener('focus', (e) => { if (e.target.id === 'gasto-valor-total') unformatCurrencyInput(e.target); });
    document.getElementById('view-remisiones').addEventListener('focusout', (e) => { if (e.target.classList.contains('item-valor-unitario')) { formatCurrencyInput(e.target); calcularTotales(); } });
    document.getElementById('view-remisiones').addEventListener('focus', (e) => { if (e.target.classList.contains('item-valor-unitario')) unformatCurrencyInput(e.target); });
}

function switchView(viewName, tabs, views) {
    Object.values(tabs).forEach(tab => { if (tab) tab.classList.remove('active') });
    Object.values(views).forEach(view => { if (view) view.classList.add('hidden') });
    if (tabs[viewName]) tabs[viewName].classList.add('active');
    if (views[viewName]) views[viewName].classList.remove('hidden');
}

// --- FUNCIONES DE CARGA Y RENDERIZADO DE DATOS ---
function loadEmpleados() {
    const empleadosListEl = document.getElementById('empleados-list');

    // Verificación de seguridad
    if (!currentUserData || currentUserData.role !== 'admin' || !empleadosListEl) {
        return () => { };
    }

    const q = query(collection(db, "users"));

    return onSnapshot(q, (snapshot) => {
        // Mapear y guardar en variable global
        const users = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        allUsers = users;

        empleadosListEl.innerHTML = '';

        // Ordenar: Pendientes primero, luego alfabéticamente
        users.sort((a, b) => {
            if (a.status === 'pending' && b.status !== 'pending') return -1;
            if (a.status !== 'pending' && b.status === 'pending') return 1;
            return (a.nombre || '').localeCompare(b.nombre || '');
        });

        users.filter(u => u.id !== currentUser.uid && u.status !== 'archived').forEach(empleado => {
            const el = document.createElement('div');
            el.className = 'border p-4 rounded-lg flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white shadow-sm';

            // --- LÓGICA RECUPERADA PARA BADGES Y BOTONES ---
            let statusBadge = '';
            let statusButton = '';

            switch (empleado.status) {
                case 'pending':
                    statusBadge = `<span class="px-2 py-1 text-xs font-bold rounded-full bg-yellow-100 text-yellow-800 border border-yellow-200">Pendiente</span>`;
                    statusButton = `<button data-uid="${empleado.id}" data-status="active" class="user-status-btn bg-green-500 text-white px-3 py-1 rounded-lg text-sm font-semibold hover:bg-green-600 transition">Aprobar</button>`;
                    break;
                case 'active':
                    statusBadge = `<span class="px-2 py-1 text-xs font-bold rounded-full bg-green-100 text-green-800 border border-green-200">Activo</span>`;
                    statusButton = `<button data-uid="${empleado.id}" data-status="inactive" class="user-status-btn bg-amber-500 text-white px-3 py-1 rounded-lg text-sm font-semibold hover:bg-amber-600 transition">Desactivar</button>`;
                    break;
                case 'inactive':
                    statusBadge = `<span class="px-2 py-1 text-xs font-bold rounded-full bg-gray-100 text-gray-800 border border-gray-200">Inactivo</span>`;
                    statusButton = `<button data-uid="${empleado.id}" data-status="active" class="user-status-btn bg-green-500 text-white px-3 py-1 rounded-lg text-sm font-semibold hover:bg-green-600 transition">Reactivar</button>`;
                    break;
                default:
                    statusBadge = `<span class="text-xs text-gray-500">${empleado.status}</span>`;
            }

            el.innerHTML = `
                <div class="flex-grow">
                    <div class="flex items-center gap-2 mb-1">
                        <p class="font-semibold text-lg text-gray-800">${empleado.nombre}</p>
                        ${statusBadge}
                    </div>
                    <p class="text-sm text-gray-600">${empleado.email}</p>
                    <p class="text-xs text-gray-500 capitalize">Rol: ${empleado.role}</p>
                </div>
                
                <div class="flex flex-wrap gap-2 w-full md:w-auto">
                    ${statusButton}

                    <button data-user-json='${JSON.stringify(empleado)}' class="manage-rrhh-docs-btn bg-teal-600 text-white px-3 py-1 rounded-lg text-sm font-semibold hover:bg-teal-700 transition">RRHH</button>
                    
                    <button data-user-json='${JSON.stringify(empleado)}' class="manage-user-btn bg-blue-600 text-white px-3 py-1 rounded-lg text-sm font-semibold hover:bg-blue-700 transition">Editar</button>
                    
                    <button data-uid="${empleado.id}" class="delete-user-btn bg-red-100 text-red-600 border border-red-200 px-3 py-1 rounded-lg text-sm font-semibold hover:bg-red-200 transition">Eliminar</button>
                </div>`;

            empleadosListEl.appendChild(el);
        });

        // Reasignamos los listeners porque el DOM cambió
        attachEmployeeListeners();
    });
}
// Función auxiliar para reasignar listeners (ponla justo debajo de loadEmpleados)
function attachEmployeeListeners() {
    // RRHH
    document.querySelectorAll('.manage-rrhh-docs-btn').forEach(btn =>
        btn.addEventListener('click', (e) => showRRHHModal(JSON.parse(e.currentTarget.dataset.userJson)))
    );
    // Editar
    document.querySelectorAll('.manage-user-btn').forEach(btn =>
        btn.addEventListener('click', (e) => showAdminEditUserModal(JSON.parse(e.currentTarget.dataset.userJson)))
    );
    // Eliminar
    document.querySelectorAll('.delete-user-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const uid = e.currentTarget.dataset.uid;
            if (confirm('¿Estás seguro de que quieres eliminar este usuario? Esta acción no se puede deshacer.')) {
                try {
                    await deleteDoc(doc(db, "users", uid));
                    showModalMessage("Usuario eliminado.", false, 2000);
                } catch (err) {
                    console.error(err);
                    showModalMessage("Error al eliminar.");
                }
            }
        });
    });
    // NO NECESITAMOS LISTENER PARA .user-status-btn AQUÍ
    // Porque ese ya lo tienes delegado globalmente en setupEventListeners con el evento 'click' en 'view-empleados'
}

function loadColores() {
    const q = query(collection(db, "colores"), orderBy("nombre", "asc"));
    return onSnapshot(q, (snapshot) => {
        allColores = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderColores();
    });
}
function renderColores() {
    const coloresListEl = document.getElementById('colores-list');
    if (!coloresListEl) return;
    const searchTerm = document.getElementById('search-colores').value.toLowerCase();
    const filtered = allColores.filter(c => c.nombre.toLowerCase().includes(searchTerm));

    coloresListEl.innerHTML = '';
    if (filtered.length === 0) { coloresListEl.innerHTML = '<p>No hay colores.</p>'; return; }
    filtered.forEach(color => {
        const colorDiv = document.createElement('div');
        colorDiv.className = 'border p-4 rounded-lg font-semibold';
        colorDiv.textContent = color.nombre;
        coloresListEl.appendChild(colorDiv);
    });
}
function loadItems() {
    const q = query(collection(db, "items"), orderBy("referencia", "asc"));
    return onSnapshot(q, (snapshot) => {
        allItems = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderItems();
    });
}
function renderItems() {
    const itemsListEl = document.getElementById('items-list');
    if (!itemsListEl) return;
    const searchTerm = document.getElementById('search-items').value.toLowerCase();
    const filtered = allItems.filter(i => i.referencia.toLowerCase().includes(searchTerm) || i.descripcion.toLowerCase().includes(searchTerm));

    itemsListEl.innerHTML = '';
    if (filtered.length === 0) { itemsListEl.innerHTML = '<p>No hay ítems.</p>'; return; }
    filtered.forEach(item => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'border p-4 rounded-lg';
        itemDiv.innerHTML = `<p class="font-semibold"><span class="item-ref">${item.referencia}</span> ${item.descripcion}</p>`;
        itemsListEl.appendChild(itemDiv);
    });
}
// --- FUNCIONES DE CARGA DE DATOS (ACTUALIZADAS) ---
function loadClientes() {
    const q = query(collection(db, "clientes"), orderBy("nombre", "asc"));
    return onSnapshot(q, (snapshot) => {
        allClientes = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderClientes();
    });
}

/**
 * Normaliza un texto: lo convierte a minúsculas y le quita las tildes.
 * @param {string} text - El texto a normalizar.
 * @returns {string} El texto normalizado.
 */
function normalizeText(text) {
    if (!text) return '';
    return text.toString().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function renderClientes() {
    const clientesListEl = document.getElementById('clientes-list');
    if (!clientesListEl) return;

    // 1. Normalizamos el término de búsqueda una sola vez
    const normalizedSearchTerm = normalizeText(document.getElementById('search-clientes').value);

    const clientesConHistorial = allClientes.map(cliente => {
        const remisionesCliente = allRemisiones.filter(r => r.idCliente === cliente.id && r.estado !== 'Anulada');
        const totalComprado = remisionesCliente.reduce((sum, r) => sum + r.valorTotal, 0);
        let ultimaCompra = 'N/A';
        if (remisionesCliente.length > 0) {
            remisionesCliente.sort((a, b) => new Date(b.fechaRecibido) - new Date(a.fechaRecibido));
            ultimaCompra = remisionesCliente[0].fechaRecibido;
        }
        return { ...cliente, totalComprado, ultimaCompra };
    });

    const filtered = clientesConHistorial.filter(c => {
        // 2. Creamos una cadena unificada con todos los datos del cliente y la normalizamos
        const clientDataString = [
            c.nombre,
            c.email,
            c.telefono1,
            c.telefono2,
            c.nit
        ].join(' ');

        const normalizedClientData = normalizeText(clientDataString);

        // 3. Comparamos los textos ya normalizados
        return normalizedClientData.includes(normalizedSearchTerm);
    });

    clientesListEl.innerHTML = '';
    if (filtered.length === 0) {
        clientesListEl.innerHTML = '<p class="text-center text-gray-500 py-8">No se encontraron clientes.</p>';
        return;
    }

    filtered.forEach(cliente => {
        const clienteDiv = document.createElement('div');
        clienteDiv.className = 'border p-4 rounded-lg flex flex-col sm:flex-row justify-between sm:items-start gap-4';

        const telefonos = [cliente.telefono1, cliente.telefono2].filter(Boolean).join(' | ');
        const editButton = (currentUserData && currentUserData.role === 'admin')
            ? `<button data-client-json='${JSON.stringify(cliente)}' class="edit-client-btn bg-gray-200 text-gray-700 px-3 py-1 rounded-lg text-sm font-semibold hover:bg-gray-300 w-full text-center">Editar</button>`
            : '';

        clienteDiv.innerHTML = `
            <div class="flex-grow min-w-0">
                <p class="font-semibold text-lg truncate" title="${cliente.nombre}">${cliente.nombre}</p>
                <p class="text-sm text-gray-600">${cliente.email || 'Sin correo'} | ${telefonos}</p>
                ${cliente.nit ? `<p class="text-sm text-gray-500">NIT: ${cliente.nit}</p>` : ''}
                <div class="mt-2 pt-2 border-t border-gray-100 text-sm">
                    <p><span class="font-semibold">Última Compra:</span> ${cliente.ultimaCompra}</p>
                    <p><span class="font-semibold">Total Comprado:</span> ${formatCurrency(cliente.totalComprado)}</p>
                </div>
            </div>
            <div class="flex-shrink-0 w-full sm:w-auto">
                 ${editButton}
            </div>
        `;
        clientesListEl.appendChild(clienteDiv);
    });
    document.querySelectorAll('.edit-client-btn').forEach(btn => btn.addEventListener('click', (e) => showEditClientModal(JSON.parse(e.currentTarget.dataset.clientJson))));
}

function loadProveedores() {
    const q = query(collection(db, "proveedores"), orderBy("nombre", "asc"));
    return onSnapshot(q, (snapshot) => {
        allProveedores = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderProveedores();
    });
}

function renderProveedores() {
    const proveedoresListEl = document.getElementById('proveedores-list');
    if (!proveedoresListEl) return;
    const searchTerm = document.getElementById('search-proveedores').value.toLowerCase();
    const filtered = allProveedores.filter(p => p.nombre.toLowerCase().includes(searchTerm));

    proveedoresListEl.innerHTML = '';
    if (filtered.length === 0) { proveedoresListEl.innerHTML = '<p>No hay proveedores registrados.</p>'; return; }

    filtered.forEach(proveedor => {
        const el = document.createElement('div');
        el.className = 'border p-4 rounded-lg flex justify-between items-center';
        const editButton = (currentUserData && currentUserData.role === 'admin')
            ? `<button data-provider-json='${JSON.stringify(proveedor)}' class="edit-provider-btn bg-gray-200 text-gray-700 px-3 py-1 rounded-lg text-sm font-semibold hover:bg-gray-300">Editar</button>`
            : '';
        el.innerHTML = `
            <div class="flex-grow">
                <p class="font-semibold">${proveedor.nombre}</p>
                <p class="text-sm text-gray-600">${proveedor.email || ''} | ${proveedor.telefono || ''}</p>
            </div>
            ${editButton}
        `;
        proveedoresListEl.appendChild(el);
    });
    document.querySelectorAll('.edit-provider-btn').forEach(btn => btn.addEventListener('click', (e) => showEditProviderModal(JSON.parse(e.currentTarget.dataset.providerJson))));
}

let remisionesSnapUnsubscribe = null;


async function loadRemisiones(month = 'all', year = 'all', isMore = false) {
    if (cargandoMasRemisiones) return;

    const remisionesRef = collection(db, "remisiones");
    let q;

    // 1. Si NO es paginación ("Cargar más"), limpiamos todo y apagamos el escucha anterior
    if (!isMore) {
        if (remisionesSnapUnsubscribe) remisionesSnapUnsubscribe();
        allRemisiones = [];
        lastRemisionDoc = null;
        const listEl = document.getElementById('remisiones-list');
        if (listEl) listEl.innerHTML = '<p class="text-center py-4 text-xs text-gray-500">Sincronizando historial...</p>';
    }

    // 2. Construcción de la Query (Tu lógica de filtros se mantiene)
    if (year !== 'all' && month !== 'all') {
        const start = `${year}-${(parseInt(month) + 1).toString().padStart(2, '0')}-01`;
        const end = `${year}-${(parseInt(month) + 1).toString().padStart(2, '0')}-31`;
        q = query(remisionesRef,
            where("fechaRecibido", ">=", start),
            where("fechaRecibido", "<=", end),
            orderBy("fechaRecibido", "desc"),
            orderBy("numeroRemision", "desc"),
            limit(50)
        );
    } else {
        q = query(remisionesRef, orderBy("numeroRemision", "desc"), limit(50));
    }

    // 3. Manejo de Paginación
    if (isMore && lastRemisionDoc) {
        cargandoMasRemisiones = true;
        q = query(q, startAfter(lastRemisionDoc));

        // Para "Cargar más" usamos getDocs (una sola vez) y lo añadimos al array
        try {
            const snapshot = await getDocs(q);
            if (snapshot.empty) {
                showTemporaryMessage("No hay más registros");
                cargandoMasRemisiones = false;
                return;
            }
            lastRemisionDoc = snapshot.docs[snapshot.docs.length - 1];
            const nuevas = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

            // Unimos evitando duplicados
            nuevas.forEach(n => {
                if (!allRemisiones.find(r => r.id === n.id)) allRemisiones.push(n);
            });

            renderRemisiones();
            cargandoMasRemisiones = false;
        } catch (e) { console.error(e); cargandoMasRemisiones = false; }

    } else {
        // 4. ESCUCHA EN TIEMPO REAL (Para la carga inicial y actualizaciones)
        remisionesSnapUnsubscribe = onSnapshot(q, (snapshot) => {
            snapshot.docChanges().forEach((change) => {
                const data = { id: change.doc.id, ...change.doc.data() };

                if (change.type === "added") {
                    // Solo añadimos si no existe ya (por si la paginación se cruza)
                    const index = allRemisiones.findIndex(r => r.id === data.id);
                    if (index === -1) allRemisiones.push(data);
                }
                if (change.type === "modified") {
                    // AQUÍ ESTÁ LA MAGIA: Si el pago se aprueba, Firestore avisa, 
                    // buscamos la remisión en el array y la reemplazamos.
                    const index = allRemisiones.findIndex(r => r.id === data.id);
                    if (index !== -1) allRemisiones[index] = data;
                }
                if (change.type === "removed") {
                    allRemisiones = allRemisiones.filter(r => r.id !== data.id);
                }
            });

            // Guardamos el último para la siguiente página
            if (snapshot.docs.length > 0) {
                lastRemisionDoc = snapshot.docs[snapshot.docs.length - 1];
            }

            renderRemisiones();
        }, (error) => {
            console.error("Error en el listener de remisiones:", error);
        });
    }
}

async function searchRemisionesGlobal(searchTerm) {
    const term = (searchTerm || "").trim().toLowerCase();

    if (!term) {
        loadRemisiones();
        return;
    }

    const remisionesRef = collection(db, "remisiones");

    // 1. Intentar búsqueda por número de remisión (si es numérico)
    if (!isNaN(term) && !term.includes(" ")) {
        const qNum = query(remisionesRef, where("numeroRemision", "==", parseInt(term)));
        const snap = await getDocs(qNum);
        if (!snap.empty) {
            allRemisiones = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            renderRemisiones();
            return;
        }
    }

    // 2. Búsqueda por coincidencia de texto (Case-Insensitive local)
    // Para que "Exito" funcione en "Vidrios Exito", necesitamos filtrar en el cliente
    // Pero para no gastar lecturas, limitamos la búsqueda a los documentos ya cargados 
    // o traemos los últimos 200 para buscar dentro de ellos.

    const qText = query(remisionesRef, orderBy("numeroRemision", "desc"), limit(200));
    try {
        const snapshot = await getDocs(qText);
        const results = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        // Filtrado local por coincidencia en cualquier parte del nombre
        allRemisiones = results.filter(rem => {
            const nombreCliente = (rem.clienteNombre || "").toLowerCase();
            const numRem = (rem.numeroRemision || "").toString();
            return nombreCliente.includes(term) || numRem.includes(term);
        });

        renderRemisiones();
    } catch (error) {
        console.error("Error en búsqueda:", error);
    }
}

/**
 * Renderiza la lista de remisiones asegurando el orden correcto y 
 * la precisión de fechas para Colombia.
 */
function renderRemisiones() {
    const remisionesListEl = document.getElementById('remisiones-list');
    if (!remisionesListEl) return;

    const isAdmin = currentUserData && currentUserData.role === 'admin';
    const isPlanta = currentUserData && currentUserData.role === 'planta';
    const month = document.getElementById('filter-remisiones-month').value;
    const year = document.getElementById('filter-remisiones-year').value;
    const searchTerm = document.getElementById('search-remisiones').value.toLowerCase();

    let filtered = [...allRemisiones]; // Usamos una copia para no afectar el array original

    // 1. Filtro para el rol de Planta
    if (isPlanta) {
        const allowedStates = ['Recibido', 'En Proceso', 'Procesado'];
        filtered = filtered.filter(r => allowedStates.includes(r.estado));
    }

    // 2. Filtro por Fecha (Lógica de texto para evitar desfase de Colombia)
    if (year !== 'all') {
        filtered = filtered.filter(r => r.fechaRecibido.split('-')[0] === year);
    }

    if (month !== 'all') {
        const targetMonth = parseInt(month) + 1;
        filtered = filtered.filter(r => parseInt(r.fechaRecibido.split('-')[1]) === targetMonth);
    }

    // 3. Filtro por Buscador
    if (searchTerm) {
        filtered = filtered.filter(r =>
            r.clienteNombre.toLowerCase().includes(searchTerm) ||
            r.numeroRemision.toString().includes(searchTerm)
        );
    }

    // --- ORDENAMIENTO EXPLÍCITO ---
    filtered.sort((a, b) => b.numeroRemision - a.numeroRemision);

    remisionesListEl.innerHTML = '';
    if (filtered.length === 0) {
        remisionesListEl.innerHTML = '<p class="text-center text-gray-500 py-8">No se encontraron remisiones para este período.</p>';
        return;
    }

    filtered.forEach((remision) => {
        const el = document.createElement('div');
        const esAnulada = remision.estado === 'Anulada';
        const esEntregada = remision.estado === 'Entregado';

        // --- CÁLCULO DE SALDOS ACTUALIZADO ---
        // Sumamos solo lo que ya ha sido confirmado por otro administrador
        const totalPagadoConfirmado = (remision.payments || [])
            .filter(p => p.status === 'confirmado') // Filtro crítico
            .reduce((sum, p) => sum + p.amount, 0);

        // El saldo pendiente real es el total menos lo confirmado
        const saldoPendiente = Math.max(0, remision.valorTotal - totalPagadoConfirmado);

        // Para el badge de "Abono", miramos si hay cualquier pago registrado (aunque no esté confirmado)
        const totalAbonado = (remision.payments || []).reduce((sum, p) => sum + p.amount, 0);

        let paymentStatusBadge = '';
        if (!esAnulada) {
            // Si el saldo confirmado cubre el total, está pagado
            if (saldoPendiente <= 0.01) {
                paymentStatusBadge = `<span class="payment-status payment-pagado">Pagado</span>`;
            } else if (totalAbonado > 0) {
                paymentStatusBadge = `<span class="payment-status payment-abono">Abono</span>`;
            } else {
                paymentStatusBadge = `<span class="payment-status payment-pendiente">Pendiente</span>`;
            }
        }

        const pdfPath = isPlanta ? remision.pdfPlantaPath : remision.pdfPath;
        const pdfButton = pdfPath
            ? `<button data-pdf-path="${pdfPath}" data-remision-num="${remision.numeroRemision}" class="view-pdf-btn w-full bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-green-700 transition">Ver PDF</button>`
            : `<button class="w-full bg-gray-400 text-white px-4 py-2 rounded-lg text-sm font-semibold cursor-not-allowed">Sin PDF</button>`;

        const anularButton = (esAnulada || esEntregada || isPlanta || (remision.payments && remision.payments.length > 0))
            ? ''
            : `<button data-remision-id="${remision.id}" class="anular-btn w-full bg-yellow-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-yellow-600 transition">Anular</button>`;

        // Aquí el botón mostrará ($ 0) inmediatamente cuando saldoPendiente sea 0
        const pagosButton = esAnulada || isPlanta ? '' : `<button data-remision-json='${JSON.stringify(remision)}' class="payment-btn w-full bg-purple-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-purple-700 transition">Pagos (${formatCurrency(saldoPendiente)})</button>`;

        const descuentoButton = (esAnulada || esEntregada || isPlanta || remision.discount)
            ? ''
            : `<button data-remision-json='${JSON.stringify(remision)}' class="discount-btn w-full bg-cyan-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-cyan-600 transition">Descuento</button>`;

        const statusClasses = { 'Recibido': 'status-recibido', 'En Proceso': 'status-en-proceso', 'Procesado': 'status-procesado', 'Entregado': 'status-entregado' };
        const statusBadge = `<span class="status-badge ${statusClasses[remision.estado] || ''}">${remision.estado}</span>`;

        let statusButton = '';
        const currentIndex = ESTADOS_REMISION.indexOf(remision.estado);
        if (!esAnulada && currentIndex < ESTADOS_REMISION.length - 1) {
            const nextStatus = ESTADOS_REMISION[currentIndex + 1];
            statusButton = `<button data-remision-id="${remision.id}" data-current-status="${remision.estado}" class="status-update-btn w-full bg-indigo-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-indigo-600 transition">Mover a ${nextStatus}</button>`;
        }

        let discountInfo = '';
        if (remision.discount && remision.discount.percentage > 0) {
            discountInfo = `<span class="text-xs font-semibold bg-cyan-100 text-cyan-800 px-2 py-1 rounded-full">DTO ${remision.discount.percentage.toFixed(2)}%</span>`;
        }

        el.className = `border p-4 rounded-lg flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 ${esAnulada ? 'remision-anulada' : ''}`;
        el.innerHTML = `
            <div class="flex-grow">
                <div class="flex items-center gap-3 flex-wrap">
                    <span class="remision-id">N° ${remision.numeroRemision}</span>
                    <p class="font-semibold text-lg">${remision.clienteNombre}</p>
                    ${statusBadge}
                    ${paymentStatusBadge}
                    ${discountInfo}
                    ${esAnulada ? '<span class="px-2 py-1 bg-red-200 text-red-800 text-xs font-bold rounded-full">ANULADA</span>' : ''}
                </div>
                <p class="text-sm text-gray-600 mt-1">Recibido: ${remision.fechaRecibido} &bull; ${remision.fechaEntrega ? `Entregado: ${remision.fechaEntrega}` : 'Entrega: Pendiente'}</p>
                ${!isPlanta ? `<p class="text-sm text-gray-600 mt-1">Total: <span class="font-bold">${formatCurrency(remision.valorTotal)}</span></p>` : ''}
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 flex-shrink-0 w-full sm:max-w-xs">
                ${statusButton}
                ${pdfButton}
                ${pagosButton}
                ${descuentoButton}
                ${anularButton}
            </div>`;

        remisionesListEl.appendChild(el);
    });

    attachRemisionesListeners();

    // --- MANEJO DE PAGINACIÓN AL FINAL ---
    const listContainer = document.getElementById('remisiones-list');
    document.getElementById('load-more-container')?.remove();

    if (allRemisiones.length >= 50) {
        const loadMoreDiv = document.createElement('div');
        loadMoreDiv.id = 'load-more-container';
        loadMoreDiv.className = 'pt-6 pb-4 text-center';
        loadMoreDiv.innerHTML = `
            <button id="load-more-btn" class="bg-gray-200 text-gray-700 font-bold py-2 px-6 rounded-lg hover:bg-gray-300 transition shadow-sm">
                Cargar siguientes 50 remisiones
            </button>
        `;
        listContainer.appendChild(loadMoreDiv);

        document.getElementById('load-more-btn').addEventListener('click', () => {
            const month = document.getElementById('filter-remisiones-month').value;
            const year = document.getElementById('filter-remisiones-year').value;
            loadRemisiones(month, year, true);
        });
    }
}

/**
 * Función auxiliar para reasignar listeners a los botones generados dinámicamente.
 */
function attachRemisionesListeners() {
    document.querySelectorAll('.anular-btn').forEach(button =>
        button.addEventListener('click', (e) => {
            const id = e.currentTarget.dataset.remisionId;
            if (confirm("¿Estás seguro de que quieres ANULAR esta remisión?")) handleAnularRemision(id);
        })
    );

    document.querySelectorAll('.status-update-btn').forEach(button =>
        button.addEventListener('click', (e) => {
            handleStatusUpdate(e.currentTarget.dataset.remisionId, e.currentTarget.dataset.currentStatus);
        })
    );

    document.querySelectorAll('.view-pdf-btn').forEach(button => {
        button.addEventListener('click', async (e) => {
            const pdfPath = e.currentTarget.dataset.pdfPath;
            const num = e.currentTarget.dataset.remisionNum;
            showModalMessage("Generando enlace seguro...", true);
            try {
                const getSignedUrl = httpsCallable(functions, 'getSignedUrlForPath');
                const result = await getSignedUrl({ path: pdfPath });
                hideModal();
                showPdfModal(result.data.url, `Remisión N° ${num}`);
            } catch (error) {
                hideModal();
                showModalMessage("Error al abrir el PDF.");
            }
        });
    });

    document.querySelectorAll('.payment-btn').forEach(button =>
        button.addEventListener('click', (e) => showPaymentModal(JSON.parse(e.currentTarget.dataset.remisionJson)))
    );

    document.querySelectorAll('.discount-btn').forEach(button =>
        button.addEventListener('click', (e) => showDiscountModal(JSON.parse(e.currentTarget.dataset.remisionJson)))
    );
}

async function loadGastos(month = 'all', year = 'all', isMore = false) {
    if (cargandoMasGastos) return;
    const gastosListEl = document.getElementById('gastos-list');
    const gastosRef = collection(db, "gastos");
    let q;

    if (!isMore) {
        allGastos = [];
        lastGastoDoc = null;
        if (gastosListEl) gastosListEl.innerHTML = '<p class="text-center py-4">Cargando gastos...</p>';
    }

    if (year !== 'all' && month !== 'all') {
        const start = `${year}-${(parseInt(month) + 1).toString().padStart(2, '0')}-01`;
        const end = `${year}-${(parseInt(month) + 1).toString().padStart(2, '0')}-31`;
        q = query(gastosRef, where("fecha", ">=", start), where("fecha", "<=", end), orderBy("fecha", "desc"), limit(50));
    } else {
        q = query(gastosRef, orderBy("fecha", "desc"), limit(50));
    }

    if (isMore && lastGastoDoc) {
        cargandoMasGastos = true;
        q = query(q, startAfter(lastGastoDoc));
    }

    try {
        const snapshot = await getDocs(q);
        if (snapshot.empty && isMore) {
            showTemporaryMessage("No hay más gastos", "info");
            cargandoMasGastos = false;
            return;
        }
        lastGastoDoc = snapshot.docs[snapshot.docs.length - 1];
        const nuevos = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        allGastos = [...allGastos, ...nuevos];
        renderGastos();
        cargandoMasGastos = false;
    } catch (error) {
        console.error("Error:", error);
        cargandoMasGastos = false;
    }
}


function renderGastos() {
    const gastosListEl = document.getElementById('gastos-list');
    const searchInput = document.getElementById('search-gastos');
    if (!gastosListEl || !searchInput) return;

    // 1. Capturamos y normalizamos el término de búsqueda
    const searchTerm = normalizeText(searchInput.value);

    // 2. Filtramos la lista local de gastos
    const filtered = allGastos.filter(gasto => {
        // Normalizamos los campos donde queremos buscar
        const nombreProv = normalizeText(gasto.proveedorNombre || "");
        const numFact = normalizeText(gasto.numeroFactura || "");

        // Retornamos true si el término está en el nombre o en la factura
        return nombreProv.includes(searchTerm) || numFact.includes(searchTerm);
    });

    // 3. Limpiamos la lista visual
    gastosListEl.innerHTML = '';

    // 4. Si no hay resultados tras filtrar
    if (filtered.length === 0) {
        gastosListEl.innerHTML = `
            <p class="text-center text-gray-500 py-8 bg-gray-50 rounded-lg border-2 border-dashed">
                No se encontraron gastos que coincidan con "${searchInput.value}"
            </p>`;
        return;
    }

    // 5. Dibujamos los gastos filtrados
    filtered.forEach((gasto) => {
        const el = document.createElement('div');
        el.className = 'border p-4 rounded-lg flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 bg-white shadow-sm hover:border-orange-300 transition-colors';
        el.innerHTML = `
            <div class="w-full sm:w-auto">
                <p class="font-bold text-gray-800">${gasto.proveedorNombre}</p>
                <p class="text-xs text-gray-500">${gasto.fecha} | <span class="font-medium text-gray-700">Factura: ${gasto.numeroFactura || 'N/A'}</span></p>
            </div>
            <div class="text-left sm:text-right w-full sm:w-auto">
                <p class="font-black text-lg text-red-600">${formatCurrency(gasto.valorTotal)}</p>
                <p class="text-[10px] text-gray-400 font-bold uppercase tracking-tight">Pagado con: ${gasto.fuentePago}</p>
            </div>`;
        gastosListEl.appendChild(el);
    });

    // 6. Botón de paginación (Solo se muestra si no estamos buscando para no romper la lógica de Firestore)
    if (allGastos.length >= 50 && searchTerm === "") {
        const btnContainer = document.createElement('div');
        btnContainer.className = "pt-4";
        const btn = document.createElement('button');
        btn.className = "w-full bg-gray-100 text-gray-600 py-3 rounded-xl font-bold hover:bg-gray-200 transition shadow-sm border border-gray-200";
        btn.textContent = "Cargar más gastos";
        btn.onclick = () => loadGastos(
            document.getElementById('filter-gastos-month').value,
            document.getElementById('filter-gastos-year').value,
            true
        );
        btnContainer.appendChild(btn);
        gastosListEl.appendChild(btnContainer);
    }
}

// REEMPLAZA ESTA FUNCIÓN COMPLETA EN app/js/app.js
function renderFacturacion() {
    const pendientesListEl = document.getElementById('facturacion-pendientes-list');
    const realizadasListEl = document.getElementById('facturacion-realizadas-list');

    if (!pendientesListEl || !realizadasListEl) return;

    // --- FUENTES DE DATOS INDEPENDIENTES ---
    // Pendientes viene de un onSnapshot (tiempo real)
    const pendientes = remisionesPendientesFactura;
    // Realizadas viene de la consulta paginada específica
    const realizadas = remisionesFacturadasHistorial;

    // 1. RENDERIZAR PESTAÑA: PENDIENTES
    pendientesListEl.innerHTML = '';
    if (pendientes.length === 0) {
        pendientesListEl.innerHTML = `
            <div class="text-center py-10 bg-gray-50 rounded-lg border-2 border-dashed">
                <p class="text-gray-500 font-medium">No hay remisiones pendientes de facturar.</p>
                <p class="text-xs text-gray-400">Solo aparecen remisiones marcadas con "Incluir IVA".</p>
            </div>`;
    } else {
        pendientes.forEach(remision => {
            const el = document.createElement('div');
            el.className = 'border p-4 rounded-lg flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white shadow-sm hover:shadow-md transition';
            el.innerHTML = `
                <div class="flex-grow">
                    <div class="flex items-center gap-3 flex-wrap">
                        <span class="bg-blue-100 text-blue-700 text-xs font-bold px-2 py-1 rounded">N° ${remision.numeroRemision}</span>
                        <p class="font-semibold text-lg text-gray-800">${remision.clienteNombre}</p>
                    </div>
                    <p class="text-sm text-gray-600 mt-1">
                        <i class="far fa-calendar-alt"></i> ${remision.fechaRecibido} 
                        &bull; <span class="font-bold text-indigo-600">${formatCurrency(remision.valorTotal)}</span>
                    </p>
                </div>
                <div class="flex-shrink-0 flex items-center gap-2 w-full sm:w-auto">
                    <button data-pdf-path="${remision.pdfPath}" data-remision-num="${remision.numeroRemision}" class="view-pdf-btn flex-1 sm:flex-none bg-gray-100 text-gray-700 px-4 py-2 rounded-lg text-sm font-semibold hover:bg-gray-200 transition">Ver Remisión</button>
                    <button data-remision-id="${remision.id}" class="facturar-btn flex-1 sm:flex-none bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-blue-700 transition shadow-sm">Facturar</button>
                </div>
            `;
            pendientesListEl.appendChild(el);
        });
    }

    // 2. RENDERIZAR PESTAÑA: REALIZADAS
    realizadasListEl.innerHTML = '';
    if (realizadas.length === 0) {
        realizadasListEl.innerHTML = `
            <div class="text-center py-10 bg-gray-50 rounded-lg border-2 border-dashed">
                <p class="text-gray-500 font-medium">No hay remisiones facturadas en la lista.</p>
            </div>`;
    } else {
        realizadas.forEach(remision => {
            const el = document.createElement('div');
            el.className = 'border p-4 rounded-lg flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white shadow-sm';

            // Cálculo de saldos para mostrar alertas de cobro
            const totalPagado = (remision.payments || [])
                .filter(p => p.status === 'confirmado')
                .reduce((sum, p) => sum + p.amount, 0);
            const saldoPendiente = remision.valorTotal - totalPagado;

            let actionButtons = '';

            // Botón de Factura (Ver o Adjuntar)
            if (remision.facturaPdfUrl) {
                actionButtons += `<button data-pdf-url="${remision.facturaPdfUrl}" data-remision-num="${remision.numeroFactura || remision.numeroRemision}" class="view-factura-pdf-btn bg-green-100 text-green-700 border border-green-200 px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-green-200 transition">Ver Factura</button>`;
            } else {
                actionButtons += `<button data-remision-id="${remision.id}" class="facturar-btn bg-orange-50 text-orange-700 border border-orange-200 px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-orange-100 transition">Adjuntar PDF</button>`;
            }

            // Botón de Retenciones (Solo si hay deuda)
            if (saldoPendiente > 0.01) {
                actionButtons += `<button data-remision-json='${JSON.stringify(remision)}' class="retencion-btn bg-purple-100 text-purple-700 border border-purple-200 px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-purple-200 transition">Retenciones</button>`;
            }

            el.innerHTML = `
                <div class="flex-grow">
                    <div class="flex items-center gap-3 flex-wrap">
                        <span class="bg-gray-100 text-gray-700 text-xs font-bold px-2 py-1 rounded">N° ${remision.numeroRemision}</span>
                        <p class="font-semibold text-lg text-gray-800">${remision.clienteNombre}</p>
                        <span class="px-2 py-0.5 bg-green-100 text-green-800 text-[10px] font-bold uppercase rounded-full">Facturado</span>
                    </div>
                    <p class="text-sm text-gray-600 mt-1">Total: <span class="font-bold">${formatCurrency(remision.valorTotal)}</span> ${remision.numeroFactura ? `&bull; Factura: <span class="text-blue-600 font-medium">${remision.numeroFactura}</span>` : ''}</p>
                    ${saldoPendiente > 0.01 ? `<p class="text-xs text-red-600 font-bold mt-1">SALDO PENDIENTE: ${formatCurrency(saldoPendiente)}</p>` : `<p class="text-[10px] text-green-600 font-bold mt-1 inline-flex items-center gap-1"><i class="fas fa-check-circle"></i> PAGADO TOTAL</p>`}
                </div>
                <div class="flex-shrink-0 flex items-center flex-wrap gap-2 justify-end">
                    ${actionButtons}
                    <button data-pdf-path="${remision.pdfPath}" data-remision-num="${remision.numeroRemision}" class="view-pdf-btn bg-gray-100 text-gray-500 px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-gray-200 transition">Remisión</button>
                </div>
            `;
            realizadasListEl.appendChild(el);
        });

        // --- BOTÓN DE PAGINACIÓN PARA REALIZADAS ---
        const loadMoreContainer = document.createElement('div');
        loadMoreContainer.className = 'text-center py-6';
        loadMoreContainer.innerHTML = `
            <button id="load-more-fact-btn" class="bg-white border-2 border-blue-100 text-blue-600 font-bold py-2 px-8 rounded-full hover:bg-blue-50 hover:border-blue-200 transition shadow-sm flex items-center gap-2 mx-auto">
                ${cargandoMasFacturadas ? '<i class="fas fa-spinner animate-spin"></i> Cargando...' : '<i class="fas fa-plus"></i> Cargar más facturadas'}
            </button>`;
        realizadasListEl.appendChild(loadMoreContainer);

        document.getElementById('load-more-fact-btn').addEventListener('click', () => {
            loadFacturadasHistorial(true); // Carga la siguiente página
        });
    }

    // REASIGNAR TODOS LOS LISTENERS (Modales, PDFs, etc.)
    attachFacturacionListeners();
}

// Función para reasignar eventos a los elementos de facturación tras el renderizado
function attachFacturacionListeners() {
    // Botones para abrir el modal de Facturar/Adjuntar
    document.querySelectorAll('#view-facturacion .facturar-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const remisionId = e.currentTarget.dataset.remisionId;
            showFacturaModal(remisionId);
        });
    });

    // Botones para aplicar Retenciones
    document.querySelectorAll('.retencion-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const remision = JSON.parse(e.currentTarget.dataset.remisionJson);
            showRetencionModal(remision);
        });
    });

    // Botones para Ver PDF de Remisión (Lógica asíncrona segura)
    document.querySelectorAll('#view-facturacion .view-pdf-btn').forEach(button => {
        button.addEventListener('click', async (e) => {
            const pdfPath = e.currentTarget.dataset.pdfPath;
            if (!pdfPath || pdfPath === 'undefined') {
                showModalMessage("El PDF de esta remisión aún no está disponible.");
                return;
            }
            const remisionNum = e.currentTarget.dataset.remisionNum;
            showModalMessage("Generando enlace seguro...", true);
            try {
                const getSignedUrl = httpsCallable(functions, 'getSignedUrlForPath');
                const result = await getSignedUrl({ path: pdfPath });
                hideModal();
                showPdfModal(result.data.url, `Remisión N° ${remisionNum}`);
            } catch (error) {
                hideModal();
                showModalMessage("Error: No se pudo generar el enlace para ver el PDF.");
            }
        });
    });

    // Botones para Ver PDF de Factura adjunta
    document.querySelectorAll('#view-facturacion .view-factura-pdf-btn').forEach(button => {
        button.addEventListener('click', (e) => {
            const pdfUrl = e.currentTarget.dataset.pdfUrl;
            const remisionNum = e.currentTarget.dataset.remisionNum;
            showPdfModal(pdfUrl, `Factura N° ${remisionNum}`);
        });
    });
}

// --- FUNCIONES DE MANEJO DE ACCIONES ---
async function handleProveedorSubmit(e) { e.preventDefault(); const nuevoProveedor = { nombre: document.getElementById('nuevo-proveedor-nombre').value, contacto: document.getElementById('nuevo-proveedor-contacto').value, telefono: document.getElementById('nuevo-proveedor-telefono').value, email: document.getElementById('nuevo-proveedor-email').value, creadoEn: new Date(), }; showModalMessage("Registrando proveedor...", true); try { await addDoc(collection(db, "proveedores"), nuevoProveedor); e.target.reset(); hideModal(); showModalMessage("¡Proveedor registrado!", false, 2000); } catch (error) { console.error("Error al registrar proveedor:", error); hideModal(); showModalMessage("Error al registrar el proveedor."); } }
async function handleGastoSubmit(e) {
    e.preventDefault();
    const valorTotal = unformatCurrency(document.getElementById('gasto-valor-total').value);
    const ivaIncluido = document.getElementById('gasto-iva').checked;
    const valorBase = ivaIncluido ? valorTotal / 1.19 : valorTotal;
    const proveedorId = document.getElementById('proveedor-id-hidden').value;
    const proveedorNombre = document.getElementById('proveedor-search-input').value;

    if (!proveedorId) {
        showModalMessage("Por favor, selecciona un proveedor de la lista.");
        return;
    }

    const nuevoGasto = {
        fecha: document.getElementById('gasto-fecha').value,
        proveedorId: proveedorId,
        proveedorNombre: proveedorNombre,
        numeroFactura: document.getElementById('gasto-factura').value,
        valorBase: valorBase,
        ivaIncluido: ivaIncluido,
        valorTotal: valorTotal,
        fuentePago: document.getElementById('gasto-fuente').value,
        registradoPor: currentUser.uid,
        timestamp: new Date(),
    };
    showModalMessage("Registrando gasto...", true);
    try {
        await addDoc(collection(db, "gastos"), nuevoGasto);

        const statsRef = doc(db, "estadisticas", "globales");
        await actualizarSaldoPorGasto(nuevoGasto.fuentePago, nuevoGasto.valorTotal);


        e.target.reset();
        hideModal();
        showModalMessage("¡Gasto registrado con éxito!", false, 2000);
    } catch (error) {
        console.error("Error al registrar gasto:", error);
        hideModal();
        showModalMessage("Error al registrar el gasto.");
    }
}
async function handleStatusUpdate(remisionId, currentStatus) { const currentIndex = ESTADOS_REMISION.indexOf(currentStatus); if (currentIndex < ESTADOS_REMISION.length - 1) { const nextStatus = ESTADOS_REMISION[currentIndex + 1]; const updateData = { estado: nextStatus }; if (nextStatus === 'Entregado') { updateData.fechaEntrega = new Date().toISOString().split('T')[0]; } showModalMessage("Actualizando estado...", true); try { await updateDoc(doc(db, "remisiones", remisionId), updateData); hideModal(); } catch (error) { console.error("Error al actualizar estado:", error); showModalMessage("Error al actualizar estado."); } } }
async function handleAnularRemision(remisionId) { showModalMessage("Anulando remisión...", true); try { const remisionRef = doc(db, "remisiones", remisionId); await updateDoc(remisionRef, { estado: "Anulada" }); hideModal(); showModalMessage("¡Remisión anulada con éxito!", false, 2000); } catch (error) { console.error("Error al anular la remisión:", error); hideModal(); showModalMessage("Error al anular la remisión."); } }
async function handleRemisionSubmit(e) {
    e.preventDefault();
    const clienteId = document.getElementById('cliente-id-hidden').value;
    const clienteNombre = document.getElementById('cliente-search-input').value;
    const cliente = allClientes.find(c => c.id === clienteId);

    const itemsContainer = document.getElementById('items-container');
    if (!currentUser || !clienteId || !cliente) {
        showModalMessage("Debes seleccionar un cliente válido de la lista.");
        return;
    }
    if (itemsContainer.children.length === 0) {
        showModalMessage("Debes añadir al menos un ítem.");
        return;
    }
    showModalMessage("Guardando remisión...", true);
    const counterRef = doc(db, "counters", "remisionCounter");
    try {
        const newRemisionNumber = await runTransaction(db, async (transaction) => {
            const counterDoc = await transaction.get(counterRef);
            const newNumber = (counterDoc.exists() ? counterDoc.data().currentNumber : 0) + 1;
            transaction.set(counterRef, { currentNumber: newNumber }, { merge: true });
            return newNumber;
        });
        const { subtotalGeneral, valorIVA, total } = calcularTotales();
        const items = Array.from(itemsContainer.querySelectorAll('.item-row')).map(row => ({
            itemId: row.querySelector('.item-id-hidden').value,
            referencia: row.querySelector('.item-id-hidden').dataset.ref,
            descripcion: row.querySelector('.item-id-hidden').dataset.desc,
            color: row.querySelector('.color-name-hidden').value,
            cantidad: parseFloat(row.querySelector('.item-cantidad').value) || 0,
            valorUnitario: unformatCurrency(row.querySelector('.item-valor-unitario').value) || 0,
        }));
        const formaDePago = document.getElementById('forma-pago').value;
        const initialPayments = [];
        if (formaDePago !== 'Pendiente') {
            initialPayments.push({ amount: total, date: document.getElementById('fecha-recibido').value, method: formaDePago, registeredAt: new Date(), registeredBy: currentUser.uid, status: 'confirmado' });
        }
        const nuevaRemision = {
            numeroRemision: newRemisionNumber,
            idCliente: clienteId,
            clienteNombre: clienteNombre,
            clienteEmail: cliente.email,
            fechaRecibido: document.getElementById('fecha-recibido').value,
            fechaEntrega: null,
            formaPago: formaDePago,
            incluyeIVA: document.getElementById('incluir-iva').checked,
            items: items,
            subtotal: subtotalGeneral,
            valorIVA: valorIVA,
            valorTotal: total,
            creadoPor: currentUser.uid,
            timestamp: new Date(),
            pdfUrl: null,
            emailStatus: 'pending',
            estado: 'Recibido',
            payments: initialPayments,
            facturado: false,
            numeroFactura: null,
            // **** CAMPO AÑADIDO ****
            observaciones: document.getElementById('remision-observaciones').value || ''
        };
        await addDoc(collection(db, "remisiones"), nuevaRemision);

        if (formaDePago !== 'Pendiente') {
            await actualizarSaldoPorPago(formaDePago, total);
        }

        e.target.reset();
        document.getElementById('cliente-search-input').value = '';
        document.getElementById('cliente-id-hidden').value = '';
        itemsContainer.innerHTML = '';
        itemsContainer.appendChild(createItemElement());
        calcularTotales();
        hideModal();
        showModalMessage("¡Remisión guardada!", false, 2000);
        document.getElementById('fecha-recibido').value = new Date().toISOString().split('T')[0];
    } catch (error) {
        console.error("Error en la transacción o al crear la remisión: ", error);
        hideModal();
        showModalMessage("Error al generar el número de remisión.");
    }
}

// --- FUNCIONES DE AYUDA Y MODALES ---

/**
 * Muestra un mensaje temporal no invasivo en la esquina de la pantalla.
 * Ideal para notificaciones que no deben interrumpir al usuario.
 * @param {string} message - El mensaje a mostrar.
 * @param {string} [type='info'] - El tipo de mensaje ('info', 'success', 'error').
 */
function showTemporaryMessage(message, type = 'info') {
    const colors = {
        info: 'bg-blue-500',
        success: 'bg-green-600',
        error: 'bg-red-500'
    };
    const messageEl = document.createElement('div');
    messageEl.className = `fixed top-5 right-5 ${colors[type]} text-white py-2 px-4 rounded-lg shadow-lg transition-opacity duration-300 z-50`;
    messageEl.textContent = message;
    document.body.appendChild(messageEl);

    // Desvanecer y eliminar el mensaje después de un tiempo
    setTimeout(() => {
        messageEl.classList.add('opacity-0');
        setTimeout(() => {
            messageEl.remove();
        }, 300); // Espera a que termine la transición de opacidad
    }, 2500); // El mensaje es visible por 2.5 segundos
}

/**
 * Sube un archivo a Firebase Storage y actualiza el documento del empleado.
 * Utiliza el mensaje temporal para no cerrar el modal de RRHH.
 */
async function handleFileUpload(employeeId, docPath, file) {
    if (!file) {
        showTemporaryMessage("No se seleccionó ningún archivo.", 'error');
        return;
    }
    showTemporaryMessage(`Subiendo ${file.name}...`, 'info');

    const storageRef = ref(storage, `empleados/${employeeId}/documentos/${docPath.split('.').pop()}_${Date.now()}_${file.name}`);
    try {
        const snapshot = await uploadBytes(storageRef, file);
        const downloadURL = await getDownloadURL(snapshot.ref);
        const updatePayload = {};
        updatePayload[docPath] = downloadURL;
        await updateDoc(doc(db, "users", employeeId), updatePayload);
        showTemporaryMessage("¡Documento subido con éxito!", 'success');
    } catch (error) {
        console.error("Error al subir el archivo:", error);
        showTemporaryMessage("Error al subir el archivo.", 'error');
    }
}

function initSearchableInput(searchInput, resultsContainer, getDataFn, displayFn, onSelect) {
    searchInput.addEventListener('input', () => {
        const data = getDataFn();
        const searchTerm = searchInput.value.toLowerCase();
        onSelect(null);
        if (!searchTerm) {
            resultsContainer.innerHTML = '';
            resultsContainer.classList.add('hidden');
            return;
        }
        const filteredData = data.filter(item => displayFn(item).toLowerCase().includes(searchTerm));
        renderResults(filteredData);
    });

    searchInput.addEventListener('focus', () => {
        if (searchInput.value) {
            searchInput.dispatchEvent(new Event('input'));
        }
    });

    function renderResults(results) {
        resultsContainer.innerHTML = '';
        if (results.length === 0) {
            resultsContainer.classList.add('hidden');
            return;
        }
        results.forEach(item => {
            const div = document.createElement('div');
            div.className = 'search-result-item';
            div.textContent = displayFn(item);
            div.addEventListener('mousedown', (e) => {
                e.preventDefault();
                searchInput.value = displayFn(item);
                resultsContainer.classList.add('hidden');
                if (onSelect) onSelect(item);
            });
            resultsContainer.appendChild(div);
        });
        resultsContainer.classList.remove('hidden');
    }

    // --- CLICK GLOBAL PARA ABRIR PDFs DESDE data-pdf-url (usa modal interno) ---
    if (!window.__pdfClickDelegationBound) {
        window.__pdfClickDelegationBound = true;

        // CAPTURA para interceptar antes que otros listeners
        document.addEventListener('click', (e) => {
            const el = e.target.closest('[data-pdf-url]');
            if (!el) return;

            e.preventDefault();
            if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
            e.stopPropagation();

            const pdfUrl = el.getAttribute('data-pdf-url');
            const title = el.getAttribute('data-doc-name') || el.textContent?.trim() || 'Documento';

            showPdfModal(pdfUrl, title);
        }, true);
    }
    // --- FIN CLICK GLOBAL PDFs ---

    if (!window.__pdfClickDelegationBound) {
        window.__pdfClickDelegationBound = true;

        // Usamos fase de CAPTURA (true) para interceptar antes que otros listeners
        document.addEventListener('click', (e) => {
            const el = e.target.closest('[data-pdf-url]');
            if (!el) return;

            // Evitar cualquier otra ruta (href, otros listeners, delegados previos, etc.)
            e.preventDefault();
            // bloquear burbujeo y otros listeners en el mismo target
            if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
            e.stopPropagation();

            const pdfUrl = el.getAttribute('data-pdf-url');
            const title = el.getAttribute('data-doc-name') || el.textContent?.trim() || 'Documento';

            showPdfModal(pdfUrl, title);
        }, true); // <-- CAPTURA activada
    }
}

// Esta función ahora se llama una sola vez
function setupSearchInputs() {
    // Cliente en Remisiones
    initSearchableInput(
        document.getElementById('cliente-search-input'),
        document.getElementById('cliente-search-results'),
        () => allClientes,
        (cliente) => cliente.nombre,
        (selectedCliente) => {
            const hiddenInput = document.getElementById('cliente-id-hidden');
            if (hiddenInput) hiddenInput.value = selectedCliente ? selectedCliente.id : '';
        }
    );

    // Proveedor en Gastos
    initSearchableInput(
        document.getElementById('proveedor-search-input'),
        document.getElementById('proveedor-search-results'),
        () => allProveedores,
        (proveedor) => proveedor.nombre,
        (selectedProveedor) => {
            const hiddenInput = document.getElementById('proveedor-id-hidden');
            if (hiddenInput) hiddenInput.value = selectedProveedor ? selectedProveedor.id : '';
        }
    );
}

function createItemElement() {
    dynamicElementCounter++;
    const itemRow = document.createElement('div');
    itemRow.className = 'item-row grid grid-cols-1 gap-2';
    itemRow.dataset.id = dynamicElementCounter;

    itemRow.innerHTML = `
        <div class="relative">
            <input type="text" id="item-search-${dynamicElementCounter}" autocomplete="off" placeholder="Buscar ítem..." class="item-search-input w-full p-2 border border-gray-300 rounded-lg" required>
            <input type="hidden" class="item-id-hidden" name="itemId">
            <div id="item-results-${dynamicElementCounter}" class="search-results hidden"></div>
        </div>
        <div class="relative">
            <input type="text" id="color-search-${dynamicElementCounter}" autocomplete="off" placeholder="Buscar color..." class="color-search-input w-full p-2 border border-gray-300 rounded-lg" required>
            <input type="hidden" class="color-name-hidden" name="colorName">
            <div id="color-results-${dynamicElementCounter}" class="search-results hidden"></div>
        </div>
        <div class="grid grid-cols-3 gap-2">
            <input type="number" class="item-cantidad p-2 border border-gray-300 rounded-lg" placeholder="Cant." min="1" required>
            <input type="text" inputmode="numeric" class="item-valor-unitario p-2 border border-gray-300 rounded-lg" placeholder="Vlr. Unit." required>
            <button type="button" class="remove-item-btn bg-red-500 text-white font-bold rounded-lg hover:bg-red-600">Eliminar</button>
        </div>
    `;

    setTimeout(() => {
        const itemSearchInput = document.getElementById(`item-search-${dynamicElementCounter}`);
        const itemResultsContainer = document.getElementById(`item-results-${dynamicElementCounter}`);
        const itemIdHidden = itemRow.querySelector('.item-id-hidden');

        initSearchableInput(itemSearchInput, itemResultsContainer, () => allItems, (item) => `${item.referencia} - ${item.descripcion}`, (selectedItem) => {
            itemIdHidden.value = selectedItem ? selectedItem.id : '';
            itemIdHidden.dataset.ref = selectedItem ? selectedItem.referencia : '';
            itemIdHidden.dataset.desc = selectedItem ? selectedItem.descripcion : '';
        });

        const colorSearchInput = document.getElementById(`color-search-${dynamicElementCounter}`);
        const colorResultsContainer = document.getElementById(`color-results-${dynamicElementCounter}`);
        const colorNameHidden = itemRow.querySelector('.color-name-hidden');

        initSearchableInput(colorSearchInput, colorResultsContainer, () => allColores, (color) => color.nombre, (selectedColor) => {
            colorNameHidden.value = selectedColor ? selectedColor.nombre : '';
        });
    }, 0);

    itemRow.querySelector('.remove-item-btn').addEventListener('click', () => { itemRow.remove(); calcularTotales(); });
    itemRow.querySelectorAll('input.item-cantidad, input.item-valor-unitario').forEach(input => input.addEventListener('input', calcularTotales));

    return itemRow;
}

function calcularTotales() {
    const itemsContainer = document.getElementById('items-container');
    const ivaCheckbox = document.getElementById('incluir-iva');
    const subtotalEl = document.getElementById('subtotal');
    const valorIvaEl = document.getElementById('valor-iva');
    const valorTotalEl = document.getElementById('valor-total');

    if (!itemsContainer || !ivaCheckbox || !subtotalEl || !valorIvaEl || !valorTotalEl) return { subtotalGeneral: 0, valorIVA: 0, total: 0 };

    let subtotalGeneral = 0;
    itemsContainer.querySelectorAll('.item-row').forEach(row => {
        const cantidad = parseFloat(row.querySelector('.item-cantidad').value) || 0;
        const valorUnitario = unformatCurrency(row.querySelector('.item-valor-unitario').value);
        subtotalGeneral += cantidad * valorUnitario;
    });

    // Redondeamos el subtotal por si acaso
    subtotalGeneral = Math.round(subtotalGeneral);

    const incluyeIVA = ivaCheckbox.checked;
    // AQUÍ ESTÁ EL CAMBIO CLAVE: Math.round() para eliminar decimales del IVA
    const valorIVA = incluyeIVA ? Math.round(subtotalGeneral * 0.19) : 0;

    const total = subtotalGeneral + valorIVA;

    subtotalEl.textContent = formatCurrency(subtotalGeneral);
    valorIvaEl.textContent = formatCurrency(valorIVA);
    valorTotalEl.textContent = formatCurrency(total);

    return { subtotalGeneral, valorIVA, total };
}

function showEditClientModal(client) { const modalContentWrapper = document.getElementById('modal-content-wrapper'); modalContentWrapper.innerHTML = `<div class="bg-white rounded-lg p-6 shadow-xl max-w-sm w-full mx-auto text-center"><h2 class="text-xl font-semibold mb-4">Editar Cliente</h2><form id="edit-client-form" class="space-y-4 text-left"><input type="hidden" id="edit-client-id" value="${client.id}"><div><label for="edit-client-name" class="block text-sm font-medium text-gray-700">Nombre</label><input type="text" id="edit-client-name" class="w-full p-2 border border-gray-300 rounded-lg mt-1" value="${client.nombre}" required></div><div><label for="edit-client-email" class="block text-sm font-medium text-gray-700">Correo</label><input type="email" id="edit-client-email" class="w-full p-2 border border-gray-300 rounded-lg mt-1" value="${client.email}" required></div><div><label for="edit-client-phone1" class="block text-sm font-medium text-gray-700">Teléfono 1</label><input type="tel" id="edit-client-phone1" class="w-full p-2 border border-gray-300 rounded-lg mt-1" value="${client.telefono1 || ''}" required></div><div><label for="edit-client-phone2" class="block text-sm font-medium text-gray-700">Teléfono 2</label><input type="tel" id="edit-client-phone2" class="w-full p-2 border border-gray-300 rounded-lg mt-1" value="${client.telefono2 || ''}"></div><div><label for="edit-client-nit" class="block text-sm font-medium text-gray-700">NIT</label><input type="text" id="edit-client-nit" class="w-full p-2 border border-gray-300 rounded-lg mt-1" value="${client.nit || ''}"></div><div class="flex gap-4 justify-end pt-4"><button type="button" id="cancel-edit-btn" class="bg-gray-200 text-gray-700 px-4 py-2 rounded-lg font-semibold">Cancelar</button><button type="submit" class="bg-indigo-600 text-white px-4 py-2 rounded-lg font-semibold">Guardar Cambios</button></div></form></div>`; document.getElementById('modal').classList.remove('hidden'); document.getElementById('cancel-edit-btn').addEventListener('click', hideModal); document.getElementById('edit-client-form').addEventListener('submit', async (e) => { e.preventDefault(); const clientId = document.getElementById('edit-client-id').value; const updatedData = { nombre: document.getElementById('edit-client-name').value, email: document.getElementById('edit-client-email').value, telefono1: document.getElementById('edit-client-phone1').value, telefono2: document.getElementById('edit-client-phone2').value, nit: document.getElementById('edit-client-nit').value, }; showModalMessage("Actualizando cliente...", true); try { await updateDoc(doc(db, "clientes", clientId), updatedData); hideModal(); showModalMessage("¡Cliente actualizado!", false, 2000); } catch (error) { console.error("Error al actualizar cliente:", error); showModalMessage("Error al actualizar."); } }); }
function showEditProviderModal(provider) { const modalContentWrapper = document.getElementById('modal-content-wrapper'); modalContentWrapper.innerHTML = `<div class="bg-white rounded-lg p-6 shadow-xl max-w-sm w-full mx-auto text-center"><h2 class="text-xl font-semibold mb-4">Editar Proveedor</h2><form id="edit-provider-form" class="space-y-4 text-left"><input type="hidden" id="edit-provider-id" value="${provider.id}"><div><label for="edit-provider-name" class="block text-sm font-medium text-gray-700">Nombre</label><input type="text" id="edit-provider-name" class="w-full p-2 border border-gray-300 rounded-lg mt-1" value="${provider.nombre}" required></div><div><label for="edit-provider-contact" class="block text-sm font-medium text-gray-700">Contacto</label><input type="text" id="edit-provider-contact" class="w-full p-2 border border-gray-300 rounded-lg mt-1" value="${provider.contacto || ''}"></div><div><label for="edit-provider-phone" class="block text-sm font-medium text-gray-700">Teléfono</label><input type="tel" id="edit-provider-phone" class="w-full p-2 border border-gray-300 rounded-lg mt-1" value="${provider.telefono || ''}"></div><div><label for="edit-provider-email" class="block text-sm font-medium text-gray-700">Correo</label><input type="email" id="edit-provider-email" class="w-full p-2 border border-gray-300 rounded-lg mt-1" value="${provider.email || ''}"></div><div class="flex gap-4 justify-end pt-4"><button type="button" id="cancel-edit-btn" class="bg-gray-200 text-gray-700 px-4 py-2 rounded-lg font-semibold">Cancelar</button><button type="submit" class="bg-indigo-600 text-white px-4 py-2 rounded-lg font-semibold">Guardar Cambios</button></div></form></div>`; document.getElementById('modal').classList.remove('hidden'); document.getElementById('cancel-edit-btn').addEventListener('click', hideModal); document.getElementById('edit-provider-form').addEventListener('submit', async (e) => { e.preventDefault(); const providerId = document.getElementById('edit-provider-id').value; const updatedData = { nombre: document.getElementById('edit-provider-name').value, contacto: document.getElementById('edit-provider-contact').value, telefono: document.getElementById('edit-provider-phone').value, email: document.getElementById('edit-provider-email').value, }; showModalMessage("Actualizando proveedor...", true); try { await updateDoc(doc(db, "proveedores", providerId), updatedData); hideModal(); showModalMessage("¡Proveedor actualizado!", false, 2000); } catch (error) { console.error("Error al actualizar proveedor:", error); showModalMessage("Error al actualizar."); } }); }
// REEMPLAZA ESTA FUNCIÓN COMPLETA EN app/js/app.js
function showPdfModal(pdfUrl, title) {
    // **** INICIO CORRECCIÓN AQUÍ ****
    // Verificación inicial para evitar que se abra una URL inválida.
    if (!pdfUrl || typeof pdfUrl !== 'string' || !pdfUrl.startsWith('http')) {
        console.error("showPdfModal fue llamada con una URL inválida:", pdfUrl);
        showModalMessage("Error: El enlace del documento no es válido o no está disponible.");
        return;
    }
    // **** FIN CORRECCIÓN AQUÍ ****

    try {
        const modal = document.getElementById('modal');
        const modalContentWrapper = document.getElementById('modal-content-wrapper');

        if (!modal || !modalContentWrapper) {
            window.open(pdfUrl, '_blank', 'noopener,noreferrer');
            return;
        }

        modalContentWrapper.innerHTML = `
            <div class="bg-white rounded-lg shadow-xl w-full max-w-6xl mx-auto flex flex-col" style="height: 80vh;">
                <div class="flex justify-between items-center p-4 border-b">
                    <h2 class="text-xl font-semibold">Visor: ${title || 'Documento'}</h2>
                    <button id="close-pdf-modal" class="text-gray-500 hover:text-gray-800 text-3xl">&times;</button>
                </div>
                <div class="flex-grow p-2 bg-gray-200">
                    <iframe id="pdf-iframe" src="${pdfUrl}" class="w-full h-full" frameborder="0" allow="fullscreen"></iframe>
                </div>
            </div>`;

        modal.classList.remove('hidden');

        const closeModalAndCleanUp = () => {
            modal.classList.add('hidden');
            modal.removeEventListener('click', backdropHandler);
            document.removeEventListener('keydown', escHandler);
        };

        const backdropHandler = (ev) => { if (ev.target === modal) closeModalAndCleanUp(); };
        const escHandler = (ev) => { if (ev.key === 'Escape') closeModalAndCleanUp(); };

        document.getElementById('close-pdf-modal').addEventListener('click', closeModalAndCleanUp);
        modal.addEventListener('click', backdropHandler);
        document.addEventListener('keydown', escHandler);

    } catch (err) {
        window.open(pdfUrl, '_blank', 'noopener,noreferrer');
        console.error('showPdfModal error:', err);
    }
}
// REEMPLAZA ESTA FUNCIÓN COMPLETA EN app/js/app.js
async function showPaymentModal(remisionOriginal) {
    const modalContentWrapper = document.getElementById('modal-content-wrapper');
    const remRef = doc(db, "remisiones", remisionOriginal.id);

    if (paymentModalUnsubscribe) paymentModalUnsubscribe();

    paymentModalUnsubscribe = onSnapshot(remRef, (docSnap) => {
        if (!docSnap.exists()) return;

        const remision = { id: docSnap.id, ...docSnap.data() };

        // --- CÁLCULOS ---
        const totalConfirmado = (remision.payments || []).filter(p => p.status === 'confirmado').reduce((sum, p) => sum + p.amount, 0);
        const totalPorConfirmar = (remision.payments || []).filter(p => p.status === 'por confirmar').reduce((sum, p) => sum + p.amount, 0);
        const saldoPendiente = remision.valorTotal - totalConfirmado;
        const saldoRealPendiente = remision.valorTotal - totalConfirmado - totalPorConfirmar;

        // --- GENERACIÓN DE HTML ---
        const paymentsHTML = (remision.payments || []).map((p, index) => {
            let statusBadge = '';
            let actionButtons = '';

            if (p.status === 'por confirmar') {
                statusBadge = `<span class="text-xs font-semibold bg-yellow-200 text-yellow-800 px-2 py-1 rounded-full">Por Confirmar</span>`;
                if (currentUserData.role === 'admin') {
                    if (p.registeredBy !== currentUser.uid) {
                        actionButtons = `
                        <div class="flex flex-col gap-1">
                            <button data-remision-id="${remision.id}" data-payment-index="${index}" class="confirm-payment-btn bg-green-600 text-white text-[10px] px-2 py-1 rounded hover:bg-green-700">Confirmar</button>
                            <button data-remision-id="${remision.id}" data-payment-index="${index}" class="reject-payment-btn bg-red-600 text-white text-[10px] px-2 py-1 rounded hover:bg-red-700">Rechazar</button>
                        </div>`;
                    } else {
                        actionButtons = `<span class="text-[10px] text-orange-600 italic font-medium">Requiere otro Admin</span>`;
                    }
                }
            } else if (p.status === 'rechazado') {
                statusBadge = `<span class="text-xs font-semibold bg-red-200 text-red-800 px-2 py-1 rounded-full">Rechazado</span>`;
            } else {
                statusBadge = `<span class="text-xs font-semibold bg-green-200 text-green-800 px-2 py-1 rounded-full">Confirmado</span>`;
            }

            return `<tr class="border-b">
                <td class="p-2">${p.date}</td>
                <td class="p-2">${p.method}</td>
                <td class="p-2 text-right">${formatCurrency(p.amount)}</td>
                <td class="p-2">${statusBadge}</td>
                <td class="p-2">${actionButtons}</td>
            </tr>`;
        }).join('');

        modalContentWrapper.innerHTML = `
        <div class="bg-white rounded-lg p-6 shadow-xl max-w-3xl w-full mx-auto text-left flex flex-col max-h-[85vh]">
            <div class="flex-shrink-0">
                <div class="flex justify-between items-center mb-4">
                    <h2 class="text-xl font-semibold">Gestionar Pagos (Remisión N° ${remision.numeroRemision})</h2>
                    <button id="close-payment-modal" class="text-gray-500 hover:text-gray-800 text-3xl">&times;</button>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4 text-center">
                    <div class="bg-blue-50 p-3 rounded-lg"><div class="text-sm text-blue-800 font-bold">TOTAL</div><div class="font-bold text-lg">${formatCurrency(remision.valorTotal)}</div></div>
                    <div class="bg-green-50 p-3 rounded-lg"><div class="text-sm text-green-800 font-bold">PAGADO</div><div class="font-bold text-lg">${formatCurrency(totalConfirmado)}</div></div>
                    <div class="bg-yellow-50 p-3 rounded-lg"><div class="text-sm text-yellow-800 font-bold">PENDIENTE</div><div class="font-bold text-lg">${formatCurrency(totalPorConfirmar)}</div></div>
                    <div class="bg-red-50 p-3 rounded-lg"><div class="text-sm text-red-800 font-bold">SALDO</div><div class="font-bold text-lg">${formatCurrency(saldoPendiente)}</div></div>
                </div>
            </div>
            <div class="flex-grow overflow-y-auto pr-2">
                <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                        <h3 class="font-semibold mb-2">Historial</h3>
                        <div class="border rounded-lg max-h-60 overflow-y-auto">
                            <table class="w-full text-sm">
                                <thead class="bg-gray-50 sticky top-0"><tr><th class="p-2 text-left text-[10px]">Fecha</th><th class="p-2 text-left text-[10px]">Metodo</th><th class="p-2 text-right text-[10px]">Monto</th><th class="p-2 text-left text-[10px]">Estado</th><th></th></tr></thead>
                                <tbody>${paymentsHTML || '<tr><td colspan="5" class="p-4 text-center">No hay pagos</td></tr>'}</tbody>
                            </table>
                        </div>
                    </div>
                    <div>
                        <h3 class="font-semibold mb-2 text-indigo-700">Nuevo Abono</h3>
                        ${saldoRealPendiente > 0.01 ? `
                            <form id="add-payment-form" class="space-y-3 bg-indigo-50 p-4 rounded-xl border border-indigo-100">
                                <div><label class="text-[10px] font-bold text-indigo-400 uppercase">Monto</label><input type="text" id="new-payment-amount" class="w-full p-2 border rounded-md" required></div>
                                <div class="grid grid-cols-2 gap-2">
                                    <div><label class="text-[10px] font-bold text-indigo-400 uppercase">Fecha</label><input type="date" id="new-payment-date" class="w-full p-2 border rounded-md" value="${new Date().toISOString().split('T')[0]}" required></div>
                                    <div><label class="text-[10px] font-bold text-indigo-400 uppercase">Método</label><select id="new-payment-method" class="w-full p-2 border rounded-md bg-white" required><option>Efectivo</option><option>Nequi</option><option>Davivienda</option></select></div>
                                </div>
                                <button type="submit" class="w-full bg-indigo-600 text-white font-bold py-2 rounded-lg hover:bg-indigo-700 transition">Registrar Abono</button>
                            </form>` : '<div class="bg-green-100 text-green-800 p-4 rounded-lg text-center font-bold">PAGADA</div>'}
                    </div>
                </div>
            </div>
        </div>`;

        // MOSTRAR MODAL
        document.getElementById('modal').classList.remove('hidden');

        // CERRAR MODAL
        document.getElementById('close-payment-modal').onclick = () => {
            if (paymentModalUnsubscribe) paymentModalUnsubscribe();
            hideModal();
        };

        // ACCIÓN: CONFIRMAR (Sin loader que borre la pantalla)
        document.querySelectorAll('.confirm-payment-btn').forEach(btn => {
            btn.onclick = async (e) => {
                const idx = parseInt(e.currentTarget.dataset.paymentIndex);
                e.currentTarget.disabled = true;
                try {
                    const freshSnap = await getDoc(remRef);
                    const freshData = freshSnap.data();
                    const p = freshData.payments[idx];

                    p.status = 'confirmado';
                    p.confirmedBy = currentUser.uid;
                    p.confirmedAt = new Date();

                    await updateDoc(remRef, { payments: freshData.payments });
                    await actualizarSaldoPorPago(p.method, p.amount);

                    // ==========================================
                    // ACTUALIZACIÓN MANUAL PARA EL HISTORIAL
                    // ==========================================
                    // Buscamos la remisión en el array de la lista principal
                    const indexEnHistorial = allRemisiones.findIndex(r => r.id === remisionId);
                    if (indexEnHistorial !== -1) {
                        // Actualizamos los datos en la memoria del navegador
                        allRemisiones[indexEnHistorial].payments = freshData.payments;
                        // Mandamos a redibujar el historial de remisiones inmediatamente
                        renderRemisiones();
                    }
                    // ==========================================

                    showTemporaryMessage("Pago confirmado", "success");
                } catch (err) { console.error(err); }
            };
        });

        // ACCIÓN: RECHAZAR
        document.querySelectorAll('.reject-payment-btn').forEach(btn => {
            btn.onclick = async (e) => {
                const reason = prompt("Motivo:");
                if (!reason) return;
                const idx = parseInt(e.currentTarget.dataset.paymentIndex);
                try {
                    const freshSnap = await getDoc(remRef);
                    const freshData = freshSnap.data();
                    freshData.payments[idx].status = 'rechazado';
                    freshData.payments[idx].rejectionReason = reason;
                    freshData.payments[idx].rejectedBy = currentUser.uid;
                    await updateDoc(remRef, { payments: freshData.payments });
                    showTemporaryMessage("Rechazado", "info");
                } catch (err) { console.error(err); }
            };
        });

        // ACCIÓN: NUEVO PAGO
        const addPayForm = document.getElementById('add-payment-form');
        if (addPayForm) {
            const amountInput = document.getElementById('new-payment-amount');
            amountInput.onfocus = (e) => unformatCurrencyInput(e.target);
            amountInput.onblur = (e) => formatCurrencyInput(e.target);

            addPayForm.onsubmit = async (e) => {
                e.preventDefault();
                const amount = unformatCurrency(amountInput.value);
                if (amount <= 0 || amount > saldoRealPendiente + 10) return alert("Monto inválido");

                try {
                    await updateDoc(remRef, {
                        payments: arrayUnion({
                            amount,
                            date: document.getElementById('new-payment-date').value,
                            method: document.getElementById('new-payment-method').value,
                            registeredAt: new Date(),
                            registeredBy: currentUser.uid,
                            status: 'por confirmar'
                        })
                    });
                    showTemporaryMessage("Abono registrado", "success");
                } catch (err) { console.error(err); }
            };
        }
    });
}


function showDashboardModal() {
    const modalContentWrapper = document.getElementById('modal-content-wrapper');
    const now = new Date();
    const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

    // 1. Inyectar el HTML Estructural
    modalContentWrapper.innerHTML = `
        <div class="bg-white rounded-lg shadow-xl w-full max-w-6xl mx-auto text-left flex flex-col" style="height: 80vh;">
            <div class="flex justify-between items-center p-4 border-b flex-shrink-0">
                <h2 class="text-xl font-semibold">Resumen Financiero</h2>
                <div class="flex items-center gap-4">
                    ${!saldosYaConfigurados ? `
                        <button id="btn-saldos-iniciales" onclick="showSaldosInicialesModal()" class="bg-teal-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-teal-700 shadow-md flex items-center gap-2">
                            <i class="fas fa-coins"></i> Config. Saldos Iniciales
                        </button>
                    ` : ''}
                    <button id="close-dashboard-modal" class="text-gray-500 hover:text-gray-800 text-3xl">&times;</button>
                </div>
            </div>

            <div class="border-b border-gray-200 flex-shrink-0">
                <nav class="-mb-px flex space-x-6 px-6">
                    <button id="dashboard-tab-summary" class="dashboard-tab-btn active py-4 px-1 font-semibold">Resumen Mensual</button>
                    <button id="dashboard-tab-cartera" class="dashboard-tab-btn py-4 px-1 font-semibold">Cartera</button>
                    <button id="dashboard-tab-clientes" class="dashboard-tab-btn py-4 px-1 font-semibold">Clientes</button>
                    <button id="dashboard-tab-actions" class="dashboard-tab-btn py-4 px-1 font-semibold">Acciones</button>
                </nav>
            </div>
            
            <div id="dashboard-summary-view" class="p-6 space-y-6 overflow-y-auto flex-grow">
                 <div class="flex items-center gap-4">
                    <select id="summary-month" class="p-2 border rounded-lg bg-white shadow-sm"></select>
                    <select id="summary-year" class="p-2 border rounded-lg bg-white shadow-sm"></select>
                 </div>
                 <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div class="bg-green-100 p-4 rounded-lg"><div class="text-sm font-semibold text-green-800">VENTAS</div><div id="summary-sales" class="text-2xl font-bold">$ 0</div></div>
                    <div class="bg-red-100 p-4 rounded-lg"><div class="text-sm font-semibold text-red-800">GASTOS</div><div id="summary-expenses" class="text-2xl font-bold">$ 0</div></div>
                    <div class="bg-indigo-100 p-4 rounded-lg"><div class="text-sm font-semibold text-indigo-800">UTILIDAD/PÉRDIDA</div><div id="summary-profit" class="text-2xl font-bold">$ 0</div></div>
                    <div class="bg-yellow-100 p-4 rounded-lg"><div class="text-sm font-semibold text-yellow-800">CARTERA PENDIENTE (MES)</div><div id="summary-cartera" class="text-2xl font-bold">$ 0</div></div>
                 </div>
                 <div>
                    <h3 class="font-semibold mb-2 text-gray-700">Saldos Estimados (Total Actual)</h3>
                    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                        <div class="bg-gray-100 p-4 rounded-lg"><div class="text-sm font-semibold text-gray-800">EFECTIVO</div><div id="summary-efectivo" class="text-xl font-bold">...</div></div>
                        <div class="bg-gray-100 p-4 rounded-lg"><div class="text-sm font-semibold text-gray-800">NEQUI</div><div id="summary-nequi" class="text-xl font-bold">...</div></div>
                        <div class="bg-gray-100 p-4 rounded-lg"><div class="text-sm font-semibold text-gray-800">DAVIVIENDA</div><div id="summary-davivienda" class="text-xl font-bold">...</div></div>
                        <div class="bg-gray-100 p-4 rounded-lg"><div class="text-sm font-semibold text-gray-800">CARTERA TOTAL</div><div id="summary-cartera-total" class="text-xl font-bold">...</div></div>
                    </div>
                 </div>
                 <div>
                    <h3 class="font-semibold mb-2 text-gray-700">Dinero Recibido vs. Gastos (Últimos 6 Meses)</h3>
                    <div class="bg-gray-50 p-4 rounded-lg border shadow-inner"><canvas id="profitLossChart"></canvas></div>
                 </div>
            </div>
            
            <div id="dashboard-cartera-view" class="p-6 hidden flex-grow flex flex-col min-h-0">
                <div class="border-b border-gray-200 flex-shrink-0">
                    <nav class="-mb-px flex space-x-4">
                        <button id="cartera-tab-detalle" class="cartera-tab-btn active py-3 px-1 text-sm font-semibold">Detalle por Remisión</button>
                        <button id="cartera-tab-cliente" class="cartera-tab-btn py-3 px-1 text-sm font-semibold">Total por Cliente</button>
                    </nav>
                </div>
                <div class="mt-4 flex-grow overflow-y-auto">
                    <div id="cartera-detalle-view">
                        <div id="cartera-list" class="space-y-4"></div>
                        <div id="cartera-total" class="text-right font-bold text-xl mt-6 p-4 bg-red-50 rounded-lg text-red-700"></div>
                    </div>
                    <div id="cartera-cliente-view" class="hidden">
                        <div id="cartera-por-cliente-list" class="space-y-3"></div>
                    </div>
                </div>
            </div>

            <div id="dashboard-clientes-view" class="p-6 hidden flex-grow overflow-y-auto">
                <h3 class="font-semibold mb-4 text-xl">Ranking de Mejores Clientes</h3>
                <div class="flex flex-wrap items-center gap-4 mb-6 p-4 bg-gray-50 rounded-xl border border-gray-100">
                    <div class="flex items-center gap-2">
                        <label class="text-sm font-bold text-gray-600">Desde:</label>
                        <select id="rank-start-month" class="p-2 border rounded-lg bg-white shadow-sm"></select>
                        <select id="rank-start-year" class="p-2 border rounded-lg bg-white shadow-sm"></select>
                    </div>
                    <div class="flex items-center gap-2">
                        <label class="text-sm font-bold text-gray-600">Hasta:</label>
                        <select id="rank-end-month" class="p-2 border rounded-lg bg-white shadow-sm"></select>
                        <select id="rank-end-year" class="p-2 border rounded-lg bg-white shadow-sm"></select>
                    </div>
                    <button id="rank-filter-btn" class="bg-indigo-600 text-white font-bold py-2 px-6 rounded-lg hover:bg-indigo-700 shadow-md transition">
                        Filtrar Ranking
                    </button>
                </div>
                <div id="top-clientes-list" class="space-y-3"></div>
            </div>

            <div id="dashboard-actions-view" class="p-6 hidden flex-grow overflow-y-auto">
                <h3 class="text-lg font-semibold mb-4 text-gray-800 border-b pb-2">Exportación de Reportes</h3>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
                    <button id="download-payments-excel-btn" class="flex items-center justify-center gap-2 bg-green-600 text-white font-bold py-4 px-4 rounded-lg hover:bg-green-700 transition shadow-sm">
                        <i class="fas fa-file-excel text-xl"></i> Excel de Pagos
                    </button>
                    <button id="export-gastos-excel-btn" class="flex items-center justify-center gap-2 bg-orange-600 text-white font-bold py-4 px-4 rounded-lg hover:bg-orange-700 transition shadow-sm">
                        <i class="fas fa-receipt text-xl"></i> Excel de Gastos
                    </button>
                    <button id="export-remisiones-excel-btn" class="flex items-center justify-center gap-2 bg-teal-600 text-white font-bold py-4 px-4 rounded-lg hover:bg-teal-700 transition shadow-sm">
                        <i class="fas fa-file-invoice text-xl"></i> Excel de Remisiones
                    </button>
                    <button id="download-report-btn" class="flex items-center justify-center gap-2 bg-blue-600 text-white font-bold py-4 px-4 rounded-lg hover:bg-blue-700 transition shadow-sm">
                        <i class="fas fa-file-pdf text-xl"></i> Reporte Detallado PDF
                    </button>
                </div>

                <h3 class="text-lg font-semibold mb-4 text-red-700 border-b pb-2">Mantenimiento de Datos</h3>
                <div class="bg-red-50 p-6 rounded-xl border border-red-100">
                    <p class="text-sm text-red-800 mb-2 font-bold">
                        <i class="fas fa-exclamation-triangle"></i> Sincronización de Saldos Globales
                    </p>
                    <p class="text-xs text-red-700 mb-4 leading-relaxed">
                        Si notas que los saldos de Efectivo, Nequi o Davivienda no coinciden con la realidad, usa este botón. 
                        El sistema recalculará toda la historia para corregir posibles descuadres.
                    </p>
                    <button id="sync-balances-btn" class="w-full sm:w-auto bg-red-600 text-white font-bold py-3 px-8 rounded-lg hover:bg-red-700 transition shadow-md flex items-center justify-center gap-2">
                        <i class="fas fa-sync-alt"></i> Sincronizar Saldos Ahora
                    </button>
                </div>
            </div>
        </div>
    `;

    document.getElementById('modal').classList.remove('hidden');
    document.getElementById('close-dashboard-modal').addEventListener('click', hideModal);

    // 2. Poblar Todos los Selectores de Fecha (Resumen y Ranking)
    const selectors = {
        months: [
            document.getElementById('summary-month'),
            document.getElementById('rank-start-month'),
            document.getElementById('rank-end-month')
        ],
        years: [
            document.getElementById('summary-year'),
            document.getElementById('rank-start-year'),
            document.getElementById('rank-end-year')
        ]
    };

    selectors.months.forEach(sel => {
        if (!sel) return;
        monthNames.forEach((name, i) => {
            const opt = document.createElement('option');
            opt.value = i; opt.textContent = name;
            if (i === now.getMonth()) opt.selected = true;
            sel.appendChild(opt);
        });
    });

    selectors.years.forEach(sel => {
        if (!sel) return;
        for (let i = 0; i < 5; i++) {
            const year = now.getFullYear() - i;
            const opt = document.createElement('option');
            opt.value = year; opt.textContent = year;
            sel.appendChild(opt);
        }
    });

    // 3. Lógica de Navegación entre Pestañas
    const tabs = {
        summary: document.getElementById('dashboard-tab-summary'),
        cartera: document.getElementById('dashboard-tab-cartera'),
        clientes: document.getElementById('dashboard-tab-clientes'),
        actions: document.getElementById('dashboard-tab-actions')
    };
    const views = {
        summary: document.getElementById('dashboard-summary-view'),
        cartera: document.getElementById('dashboard-cartera-view'),
        clientes: document.getElementById('dashboard-clientes-view'),
        actions: document.getElementById('dashboard-actions-view')
    };

    Object.keys(tabs).forEach(key => {
        tabs[key].addEventListener('click', () => {
            Object.values(tabs).forEach(t => t.classList.remove('active'));
            Object.values(views).forEach(v => v.classList.add('hidden'));
            tabs[key].classList.add('active');
            views[key].classList.remove('hidden');
        });
    });

    // Sub-pestañas de Cartera
    document.getElementById('cartera-tab-detalle').addEventListener('click', (e) => {
        e.target.classList.add('active');
        document.getElementById('cartera-tab-cliente').classList.remove('active');
        document.getElementById('cartera-detalle-view').classList.remove('hidden');
        document.getElementById('cartera-cliente-view').classList.add('hidden');
    });
    document.getElementById('cartera-tab-cliente').addEventListener('click', (e) => {
        e.target.classList.add('active');
        document.getElementById('cartera-tab-detalle').classList.remove('active');
        document.getElementById('cartera-cliente-view').classList.remove('hidden');
        document.getElementById('cartera-detalle-view').classList.add('hidden');
    });

    // 4. Listeners de Acciones y Filtros
    document.getElementById('summary-month').addEventListener('change', () => updateDashboard(parseInt(document.getElementById('summary-year').value), parseInt(document.getElementById('summary-month').value)));
    document.getElementById('summary-year').addEventListener('change', () => updateDashboard(parseInt(document.getElementById('summary-year').value), parseInt(document.getElementById('summary-month').value)));

    document.getElementById('rank-filter-btn').addEventListener('click', () => {
        const start = new Date(document.getElementById('rank-start-year').value, document.getElementById('rank-start-month').value, 1);
        const end = new Date(document.getElementById('rank-end-year').value, parseInt(document.getElementById('rank-end-month').value) + 1, 0, 23, 59, 59);
        renderTopClientes(start, end);
    });

    document.getElementById('download-payments-excel-btn').addEventListener('click', showExportPaymentsModal);
    document.getElementById('export-gastos-excel-btn').addEventListener('click', showExportGastosModal);
    document.getElementById('export-remisiones-excel-btn').addEventListener('click', showExportRemisionesModal);
    document.getElementById('download-report-btn').addEventListener('click', showReportDateRangeModal);

    document.getElementById('sync-balances-btn').addEventListener('click', () => {
        if (confirm("¿Seguro que quieres resincronizar los saldos? Esto recalculará todo el historial contable.")) {
            migrarSaldosAGlobales();
        }
    });

    // 5. Carga Inicial de Datos
    updateDashboard(now.getFullYear(), now.getMonth());
    renderCartera();
    renderTopClientes(); // Cargará el mes actual por defecto
}

// Función helper para inicializar los selectores de fecha
function initDashboardSelectors() {
    const monthSelect = document.getElementById('summary-month');
    const yearSelect = document.getElementById('summary-year');
    const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
    const now = new Date();

    if (monthSelect) {
        monthNames.forEach((name, i) => {
            const opt = document.createElement('option');
            opt.value = i; opt.textContent = name;
            if (i === now.getMonth()) opt.selected = true;
            monthSelect.appendChild(opt);
        });
        monthSelect.addEventListener('change', updateDashboardView);
    }
    if (yearSelect) {
        for (let i = 0; i < 5; i++) {
            const y = now.getFullYear() - i;
            const opt = document.createElement('option');
            opt.value = y; opt.textContent = y;
            yearSelect.appendChild(opt);
        }
        yearSelect.addEventListener('change', updateDashboardView);
    }
}

// Función helper para refrescar los datos del dashboard
function updateDashboardView() {
    const y = parseInt(document.getElementById('summary-year').value);
    const m = parseInt(document.getElementById('summary-month').value);
    updateDashboard(y, m);
}

/**
 * Actualiza el Dashboard con precisión horaria para Colombia.
 * Filtra desde el primer hasta el último segundo del mes seleccionado.
 */
async function updateDashboard(year, month) {
    const monthNamesShort = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

    const startDate = new Date(year, month - 5, 1);
    const endDate = new Date(year, month + 1, 0);

    const startStr = startDate.toISOString().split('T')[0];
    const endStr = endDate.toISOString().split('T')[0];
    const currentPrefix = `${year}-${(month + 1).toString().padStart(2, '0')}`;

    try {
        const qRem = query(collection(db, "remisiones"),
            where("fechaRecibido", ">=", startStr),
            where("fechaRecibido", "<=", endStr),
            where("estado", "!=", "Anulada"));

        const qGas = query(collection(db, "gastos"),
            where("fecha", ">=", startStr),
            where("fecha", "<=", endStr));

        const [snapRem, snapGas] = await Promise.all([getDocs(qRem), getDocs(qGas)]);

        const allDataRem = snapRem.docs.map(d => d.data());
        const allDataGas = snapGas.docs.map(d => d.data());

        const labels = [];
        const chartSales = [];
        const chartExpenses = [];

        let salesForCard = 0;
        let expensesForCard = 0;
        let carteraForCard = 0;

        for (let i = 5; i >= 0; i--) {
            const d = new Date(year, month - i, 1);
            const m = d.getMonth();
            const y = d.getFullYear();
            const prefix = `${y}-${(m + 1).toString().padStart(2, '0')}`;

            labels.push(monthNamesShort[m]);

            const monthlyExpenses = allDataGas
                .filter(g => g.fecha.startsWith(prefix))
                .reduce((sum, g) => sum + (g.valorTotal || 0), 0);

            const monthlyRecaudos = [...allDataRem, ...remisionesCartera]
                .flatMap(r => r.payments || [])
                .filter(p => p.status === 'confirmado' && p.date.startsWith(prefix))
                .reduce((sum, p) => sum + p.amount, 0);

            chartSales.push(monthlyRecaudos);
            chartExpenses.push(monthlyExpenses);

            if (prefix === currentPrefix) {
                expensesForCard = monthlyExpenses;
                salesForCard = allDataRem
                    .filter(r => r.fechaRecibido.startsWith(prefix))
                    .reduce((sum, r) => sum + (r.valorTotal || 0), 0);

                carteraForCard = allDataRem
                    .filter(r => r.fechaRecibido.startsWith(prefix))
                    .reduce((sum, r) => {
                        const paid = (r.payments || []).filter(p => p.status === 'confirmado').reduce((s, p) => s + p.amount, 0);
                        return sum + Math.max(0, r.valorTotal - paid);
                    }, 0);
            }
        }

        // --- ACTUALIZACIÓN DE LA UI (TARJETAS MENSUALES) ---
        const salesEl = document.getElementById('summary-sales');
        if (salesEl) {
            salesEl.textContent = formatCurrency(salesForCard);
            document.getElementById('summary-expenses').textContent = formatCurrency(expensesForCard);
            document.getElementById('summary-profit').textContent = formatCurrency(salesForCard - expensesForCard);
            document.getElementById('summary-cartera').textContent = formatCurrency(carteraForCard);

            const totalCarteraGlobal = remisionesCartera.reduce((sum, r) => {
                const paid = (r.payments || []).filter(p => p.status === 'confirmado').reduce((s, p) => s + p.amount, 0);
                return sum + Math.max(0, r.valorTotal - paid);
            }, 0);
            document.getElementById('summary-cartera-total').textContent = formatCurrency(totalCarteraGlobal);

            // --- ESTA ES LA PARTE QUE FALTABA: PINTAR LOS SALDOS GLOBALES ---
            document.getElementById('summary-efectivo').textContent = formatCurrency(globalesSaldos.Efectivo);
            document.getElementById('summary-nequi').textContent = formatCurrency(globalesSaldos.Nequi);
            document.getElementById('summary-davivienda').textContent = formatCurrency(globalesSaldos.Davivienda);
        }

        renderProfitLossChart(labels, chartSales, chartExpenses);

    } catch (error) {
        console.error("Error en sincronización de datos:", error);
    }
}


// Función auxiliar para renderizar el gráfico
function renderProfitLossChart(labels, salesData, expensesData) {
    const ctx = document.getElementById('profitLossChart').getContext('2d');
    if (profitLossChart) profitLossChart.destroy();

    profitLossChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    label: 'Dinero Recibido (Pagos)', // Antes decía 'Ventas'
                    data: salesData,
                    backgroundColor: 'rgba(75, 192, 192, 0.6)'
                },
                {
                    label: 'Gastos Pagados', // Antes decía 'Gastos'
                    data: expensesData,
                    backgroundColor: 'rgba(255, 99, 132, 0.6)'
                }
            ]
        },
        options: {
            responsive: true,
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: function (value) { return formatCurrency(value); }
                    }
                }
            }
        }
    });
}

function renderCartera() {
    const porClienteListEl = document.getElementById('cartera-por-cliente-list');
    const detalleListEl = document.getElementById('cartera-list');
    const totalEl = document.getElementById('cartera-total');

    if (!porClienteListEl || !detalleListEl || !totalEl) return;

    // --- CAMBIO CLAVE: Usamos remisionesCartera en lugar de allRemisiones ---
    const remisionesPendientes = remisionesCartera.map(remision => {
        const totalPagado = (remision.payments || [])
            .filter(p => p.status === 'confirmado')
            .reduce((acc, p) => acc + p.amount, 0);
        const saldoPendiente = remision.valorTotal - totalPagado;

        // Cálculo de días vencidos
        const today = new Date();
        const fechaRecibido = new Date(remision.fechaRecibido);
        fechaRecibido.setHours(0, 0, 0, 0);
        today.setHours(0, 0, 0, 0);
        const diffTime = today - fechaRecibido;
        const diasVencidos = Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));

        return { ...remision, saldoPendiente, diasVencidos };
    });

    // 2. CALCULAR CARTERA TOTAL POR CLIENTE
    const carteraPorCliente = remisionesPendientes.reduce((acc, remision) => {
        const cliente = acc[remision.clienteNombre] || { totalDeuda: 0, remisionesCount: 0 };
        cliente.totalDeuda += remision.saldoPendiente;
        cliente.remisionesCount += 1;
        acc[remision.clienteNombre] = cliente;
        return acc;
    }, {});

    const clientesOrdenados = Object.entries(carteraPorCliente).sort(([, a], [, b]) => b.totalDeuda - a.totalDeuda);

    // 3. RENDERIZAR CARTERA POR CLIENTE
    porClienteListEl.innerHTML = '';
    if (clientesOrdenados.length === 0) {
        porClienteListEl.innerHTML = '<p class="text-center text-gray-500 py-4 bg-gray-50 rounded-lg">No hay cartera pendiente por cliente.</p>';
    } else {
        clientesOrdenados.forEach(([nombreCliente, data]) => {
            const el = document.createElement('div');
            el.className = 'bg-white border p-3 rounded-lg flex justify-between items-center';
            el.innerHTML = `
                <div>
                    <p class="font-bold text-gray-900">${nombreCliente}</p>
                    <p class="text-xs text-gray-600">${data.remisionesCount} remision(es) pendiente(s)</p>
                </div>
                <div class="text-right">
                    <p class="font-bold text-lg text-red-600">${formatCurrency(data.totalDeuda)}</p>
                </div>`;
            porClienteListEl.appendChild(el);
        });
    }

    // 4. RENDERIZAR DETALLE DE CARTERA
    detalleListEl.innerHTML = '';
    if (remisionesPendientes.length === 0) {
        detalleListEl.innerHTML = '<p class="text-center text-gray-500 py-8 bg-gray-50 rounded-lg">¡Felicidades! No hay remisiones pendientes de cobro.</p>';
    } else {
        // Ordenamos por antigüedad (la más vieja primero para cobrarla rápido)
        remisionesPendientes.sort((a, b) => new Date(a.fechaRecibido) - new Date(b.fechaRecibido));
        remisionesPendientes.forEach(remision => {
            const el = document.createElement('div');
            el.className = 'bg-white border p-4 rounded-lg flex justify-between items-center';

            const diasVencidosTexto = remision.diasVencidos > 0
                ? `${remision.diasVencidos} día(s) de vencido`
                : 'Vence hoy';

            el.innerHTML = `
                <div class="flex-grow">
                    <p class="font-bold text-lg">${remision.clienteNombre}</p>
                    <p class="text-sm text-gray-600">Remisión N° ${remision.numeroRemision} &bull; Recibido: ${remision.fechaRecibido}</p>
                    <p class="text-xs text-gray-500 mt-1">Valor Total: ${formatCurrency(remision.valorTotal)}</p>
                </div>
                <div class="text-right flex-shrink-0">
                    <p class="text-sm text-red-700 font-semibold">Saldo Pendiente</p>
                    <p class="font-bold text-2xl text-red-600">${formatCurrency(remision.saldoPendiente)}</p>
                    <p class="text-xs font-semibold ${remision.diasVencidos > 15 ? 'text-red-500' : 'text-yellow-600'} mt-1">${diasVencidosTexto}</p>
                </div>`;
            detalleListEl.appendChild(el);
        });
    }

    // 5. RENDERIZAR TOTAL GENERAL
    const totalCartera = remisionesPendientes.reduce((sum, r) => sum + r.saldoPendiente, 0);
    totalEl.innerHTML = `Cartera Total Pendiente: ${formatCurrency(totalCartera)}`;
}

async function renderTopClientes(startDate, endDate) {
    const container = document.getElementById('top-clientes-list');
    if (!container) return;

    container.innerHTML = '<p class="text-center text-gray-500 py-8">Calculando ranking del periodo...</p>';

    // 1. Si no hay fechas, definimos el mes actual por defecto (Ahorro de recursos)
    const now = new Date();
    const start = startDate || new Date(now.getFullYear(), now.getMonth(), 1);
    const end = endDate || new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    const startStr = start.toISOString().split('T')[0];
    const endStr = end.toISOString().split('T')[0];

    try {
        // 2. CONSULTA ÚNICA: Traemos solo las remisiones del rango solicitado
        // Esto es mucho más barato que traer toda la historia
        const q = query(
            collection(db, "remisiones"),
            where("fechaRecibido", ">=", startStr),
            where("fechaRecibido", "<=", endStr),
            where("estado", "!=", "Anulada")
        );

        const snap = await getDocs(q);
        const remisionesRango = snap.docs.map(d => d.data());

        // 3. PROCESAMIENTO LOCAL
        // Sumamos las ventas agrupándolas por el ID del cliente
        const ventasPorCliente = remisionesRango.reduce((acc, r) => {
            acc[r.idCliente] = (acc[r.idCliente] || 0) + (r.valorTotal || 0);
            return acc;
        }, {});

        // Cruzamos con la lista global de clientes para tener los nombres
        const ranking = allClientes
            .map(cliente => ({
                ...cliente,
                totalComprado: ventasPorCliente[cliente.id] || 0,
                numCompras: remisionesRango.filter(r => r.idCliente === cliente.id).length
            }))
            .filter(c => c.totalComprado > 0) // Solo mostramos los que compraron algo en este periodo
            .sort((a, b) => b.totalComprado - a.totalComprado); // Ordenamos de mayor a menor

        // 4. RENDERIZADO
        container.innerHTML = '';
        if (ranking.length === 0) {
            container.innerHTML = `
                <div class="text-center py-8 bg-gray-50 rounded-lg">
                    <p class="text-gray-500">No se encontraron ventas entre ${startStr} y ${endStr}.</p>
                </div>`;
            return;
        }

        ranking.forEach((cliente, index) => {
            const el = document.createElement('div');
            el.className = 'border p-4 rounded-lg flex justify-between items-center bg-white shadow-sm hover:border-indigo-300 transition-colors';
            el.innerHTML = `
                <div class="flex items-center gap-4">
                    <span class="text-xl font-bold text-gray-300 w-8">#${index + 1}</span>
                    <div>
                        <p class="font-semibold text-gray-800">${cliente.nombre}</p>
                        <p class="text-xs text-gray-500">${cliente.numCompras} remisión(es) en este periodo</p>
                    </div>
                </div>
                <div class="text-right">
                    <p class="font-bold text-lg text-indigo-600">${formatCurrency(cliente.totalComprado)}</p>
                </div>`;
            container.appendChild(el);
        });

    } catch (error) {
        console.error("Error al generar ranking:", error);
        container.innerHTML = '<p class="text-center text-red-500">Error al conectar con la base de datos.</p>';
    }
}

const modal = document.getElementById('modal');
let modalTimeout;

function showModalMessage(message, isLoader = false, duration = 0) {
    const modalContentWrapper = document.getElementById('modal-content-wrapper');

    // Si ya hay un dashboard abierto, no queremos borrarlo todo con el loader
    // Solo mostramos el loader si el modal está oculto o no contiene el dashboard
    const isDashboardOpen = document.getElementById('dashboard-summary-view') !== null;

    if (isLoader && isDashboardOpen) {
        // En lugar de borrar todo, podemos mostrar un aviso sutil o simplemente ignorar el loader masivo
        console.log("Dashboard abierto: " + message);
        return;
    }

    modalContentWrapper.innerHTML = `<div id="modal-content" class="bg-white rounded-lg p-6 shadow-xl max-w-sm w-full mx-auto text-center"></div>`;
    const modalContent = document.getElementById('modal-content');
    clearTimeout(modalTimeout);

    let contentHTML = '';
    if (isLoader) {
        contentHTML = `<svg class="animate-spin h-8 w-8 text-indigo-600 mx-auto" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg><p class="mt-4 text-gray-700 font-semibold">${message}</p>`;
    } else {
        contentHTML = `<p class="text-gray-800 font-semibold mb-4">${message}</p>`;
        if (duration === 0) {
            contentHTML += `<button id="close-message-modal-btn" class="w-full bg-indigo-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-indigo-700">Cerrar</button>`;
        }
    }

    modalContent.innerHTML = contentHTML;
    modal.classList.remove('hidden');

    if (duration > 0) {
        modalTimeout = setTimeout(hideModal, duration);
    } else if (!isLoader) {
        const closeBtn = document.getElementById('close-message-modal-btn');
        if (closeBtn) {
            closeBtn.addEventListener('click', hideModal);
        }
    }
}
function hideModal() { modal.classList.add('hidden'); }

function formatCurrency(value) { return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value); }

function populateDateFilters(prefix) {
    const monthSelect = document.getElementById(`${prefix}-month`);
    const yearSelect = document.getElementById(`${prefix}-year`);
    if (!monthSelect || !yearSelect) return;

    const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

    monthSelect.innerHTML = '<option value="all">Todos los Meses</option>';
    for (let i = 0; i < 12; i++) {
        const option = document.createElement('option');
        option.value = i;
        option.textContent = monthNames[i];
        monthSelect.appendChild(option);
    }

    yearSelect.innerHTML = '<option value="all">Todos los Años</option>';
    const currentYear = new Date().getFullYear();
    for (let i = 0; i < 5; i++) {
        const year = currentYear - i;
        const option = document.createElement('option');
        option.value = year;
        option.textContent = year;
        yearSelect.appendChild(option);
    }
}
function unformatCurrency(value) {
    if (typeof value !== 'string') return parseFloat(value) || 0;
    return parseFloat(value.replace(/[^0-9]/g, '')) || 0;
}
function formatCurrencyInput(inputElement) {
    const value = unformatCurrency(inputElement.value);
    inputElement.value = value > 0 ? formatCurrency(value) : '';
}
function unformatCurrencyInput(inputElement) {
    const value = unformatCurrency(inputElement.value);
    inputElement.value = value > 0 ? value : '';
}
function showReportDateRangeModal() {
    const modalContentWrapper = document.getElementById('modal-content-wrapper');
    const now = new Date();
    const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

    let monthOptions = '';
    for (let i = 0; i < 12; i++) {
        monthOptions += `<option value="${i}" ${i === now.getMonth() ? 'selected' : ''}>${monthNames[i]}</option>`;
    }

    let yearOptions = '';
    for (let i = 0; i < 5; i++) {
        const year = now.getFullYear() - i;
        yearOptions += `<option value="${year}">${year}</option>`;
    }

    modalContentWrapper.innerHTML = `
            <div class="bg-white rounded-lg p-6 shadow-xl max-w-lg w-full mx-auto text-left">
                <div class="flex justify-between items-center mb-4">
                    <h2 class="text-xl font-semibold">Seleccionar Rango del Reporte</h2>
                    <button id="close-report-range-modal" class="text-gray-500 hover:text-gray-800 text-3xl">&times;</button>
                </div>
                <form id="report-range-form" class="space-y-4">
                    <div class="grid grid-cols-2 gap-4">
                        <div>
                            <label class="block text-sm font-medium">Mes de Inicio</label>
                            <select id="report-start-month" class="w-full p-2 border rounded-lg">${monthOptions}</select>
                        </div>
                        <div>
                            <label class="block text-sm font-medium">Año de Inicio</label>
                            <select id="report-start-year" class="w-full p-2 border rounded-lg">${yearOptions}</select>
                        </div>
                    </div>
                    <div class="grid grid-cols-2 gap-4">
                        <div>
                            <label class="block text-sm font-medium">Mes de Fin</label>
                            <select id="report-end-month" class="w-full p-2 border rounded-lg">${monthOptions}</select>
                        </div>
                        <div>
                            <label class="block text-sm font-medium">Año de Fin</label>
                            <select id="report-end-year" class="w-full p-2 border rounded-lg">${yearOptions}</select>
                        </div>
                    </div>
                    <button type="submit" class="w-full bg-blue-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-blue-700">Generar Reporte</button>
                </form>
            </div>
        `;
    document.getElementById('modal').classList.remove('hidden');
    document.getElementById('close-report-range-modal').addEventListener('click', hideModal);
    document.getElementById('report-range-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const startMonth = parseInt(document.getElementById('report-start-month').value);
        const startYear = parseInt(document.getElementById('report-start-year').value);
        const endMonth = parseInt(document.getElementById('report-end-month').value);
        const endYear = parseInt(document.getElementById('report-end-year').value);

        generateSummaryPDF(startYear, startMonth, endYear, endMonth);
        hideModal();
    });
}

function downloadPaymentsExcel(startDateStr, endDateStr) {
    // 1. Validar librería
    if (typeof XLSX === 'undefined') {
        showModalMessage("Error: La librería de Excel no se ha cargado.");
        return;
    }

    const start = new Date(startDateStr + 'T00:00:00');
    const end = new Date(endDateStr + 'T23:59:59');

    let dataParaExcel = [];

    const getNombreUsuario = (uid) => {
        if (!uid) return ""; // Si no hay ID, devolvemos vacío
        const usuario = allUsers.find(u => u.id === uid);
        return usuario ? usuario.nombre : "Usuario Desconocido";
    };

    const formatFecha = (timestamp) => {
        if (!timestamp) return "";
        const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
        return date.toLocaleString('es-CO');
    };

    allRemisiones.forEach(remision => {
        if (remision.payments && remision.payments.length > 0) {
            remision.payments.forEach(p => {

                // --- FILTRO DE FECHAS ---
                const paymentDate = new Date(p.date + 'T12:00:00');

                if (paymentDate >= start && paymentDate <= end) {

                    // Lógica para determinar quién revisó el pago
                    let revisadoPor = "Pendiente";
                    if (p.status === 'confirmado') {
                        revisadoPor = getNombreUsuario(p.confirmedBy);
                    } else if (p.status === 'rechazado') {
                        revisadoPor = getNombreUsuario(p.rejectedBy) + " (Rechazó)";
                    }

                    // Formatear estado para que se vea bonito (Capitalizar)
                    let estadoLegible = p.status;
                    if (p.status === 'por confirmar') estadoLegible = 'Por Confirmar';
                    else estadoLegible = p.status.charAt(0).toUpperCase() + p.status.slice(1);

                    const fila = {
                        "Fecha Pago": p.date,
                        "N° Remisión": remision.numeroRemision,
                        "Cliente": remision.clienteNombre,
                        "Método": p.method,
                        "Estado": estadoLegible, // Ahora muestra: Confirmado, Rechazado o Por Confirmar
                        "Valor": p.amount,
                        "Registrado Por": getNombreUsuario(p.registeredBy),
                        "Confirmado Por": revisadoPor, // Muestra quién confirmó, quién rechazó o "Pendiente"
                        "Fecha Registro": formatFecha(p.registeredAt)
                    };

                    dataParaExcel.push(fila);
                }
            });
        }
    });

    // 3. Ordenar
    dataParaExcel.sort((a, b) => new Date(b["Fecha Pago"]) - new Date(a["Fecha Pago"]));

    if (dataParaExcel.length === 0) {
        showModalMessage(`No se encontraron pagos (ni pendientes ni confirmados) entre ${startDateStr} y ${endDateStr}.`);
        return;
    }

    // 4. Generar Excel
    try {
        const worksheet = XLSX.utils.json_to_sheet(dataParaExcel);

        const wscols = [
            { wch: 12 }, // Fecha
            { wch: 10 }, // Remision
            { wch: 30 }, // Cliente
            { wch: 12 }, // Metodo
            { wch: 15 }, // Estado (Más ancho ahora)
            { wch: 15 }, // Valor
            { wch: 20 }, // Registrado
            { wch: 25 }, // Confirmado (Más ancho por si dice "Rechazó")
            { wch: 20 }  // Fecha Reg
        ];
        worksheet['!cols'] = wscols;

        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Historial Pagos");

        const fileName = `Pagos_Completo_${startDateStr}_a_${endDateStr}.xlsx`;
        XLSX.writeFile(workbook, fileName);

        showModalMessage("Excel generado exitosamente.", false, 2000);

    } catch (error) {
        console.error("Error generando Excel:", error);
        showModalMessage("Error al generar el archivo de Excel.");
    }
}

async function generateSummaryPDF(startYear, startMonth, endYear, endMonth) {
    // Asegurarnos de tener los saldos base frescos
    await loadSaldosBase();

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
    const startDate = new Date(startYear, startMonth, 1);
    const endDate = new Date(endYear, endMonth + 1, 0, 23, 59, 59);

    const rangeTitle = `${monthNames[startMonth]} ${startYear} - ${monthNames[endMonth]} ${endYear}`;

    doc.setFontSize(18);
    doc.text(`Reporte Financiero Detallado`, 105, 20, { align: "center" });
    doc.setFontSize(12);
    doc.text(rangeTitle, 105, 28, { align: "center" });

    const allPayments = allRemisiones.flatMap(r => r.payments || []);
    const bankAccounts = ['Efectivo', 'Nequi', 'Davivienda'];
    const bankDetails = {};

    bankAccounts.forEach(bank => {
        // <--- CAMBIO IMPORTANTE:
        // El saldo inicial empieza con lo que configuramos en la base de datos
        bankDetails[bank] = {
            initialBalance: globalSaldosBase[bank] || 0, // Inicia con el Saldo Base Configurado
            income: 0,
            expenses: 0,
            finalBalance: 0
        };
    });

    // Calcular Saldos Anteriores (Histórico antes de startDate)
    // Sumar Ingresos previos
    allPayments.forEach(p => {
        const pDate = new Date(p.date);
        pDate.setHours(0, 0, 0, 0);

        if (pDate < startDate) {
            // Si es un pago antiguo, se suma al saldo inicial del reporte
            if (bankDetails[p.method]) bankDetails[p.method].initialBalance += p.amount;
        } else if (pDate >= startDate && pDate <= endDate) {
            // Si está en el rango, es ingreso del periodo
            if (bankDetails[p.method]) bankDetails[p.method].income += p.amount;
        }
    });

    // Sumar/Restar Gastos previos
    allGastos.forEach(g => {
        const gDate = new Date(g.fecha);
        gDate.setHours(0, 0, 0, 0);

        if (gDate < startDate) {
            // Si es gasto antiguo, se resta del saldo inicial
            if (bankDetails[g.fuentePago]) bankDetails[g.fuentePago].initialBalance -= g.valorTotal;
        } else if (gDate >= startDate && gDate <= endDate) {
            // Si está en el rango, es gasto del periodo
            if (bankDetails[g.fuentePago]) bankDetails[g.fuentePago].expenses += g.valorTotal;
        }
    });

    // Calcular Saldos Finales
    bankAccounts.forEach(bank => {
        bankDetails[bank].finalBalance = bankDetails[bank].initialBalance + bankDetails[bank].income - bankDetails[bank].expenses;
    });

    // --- (El resto de la generación del PDF sigue igual, solo cambia el cálculo de arriba) ---

    // TABLA 1: Resumen General
    const totalIncome = Object.values(bankDetails).reduce((sum, b) => sum + b.income, 0);
    const totalExpenses = Object.values(bankDetails).reduce((sum, b) => sum + b.expenses, 0);
    const periodProfit = totalIncome - totalExpenses;

    const summaryData = [
        ['Ventas (Ingresos) en el Período', formatCurrency(totalIncome)],
        ['Gastos (Egresos) en el Período', formatCurrency(totalExpenses)],
        ['Flujo Neto del Período', formatCurrency(periodProfit)],
    ];

    doc.autoTable({
        startY: 35,
        head: [['Concepto General', 'Valor Total']],
        body: summaryData,
        theme: 'grid',
        headStyles: { fillColor: [41, 128, 185] },
        styles: { fontSize: 11 }
    });

    // TABLA 2: Conciliación Bancaria
    const bankTableData = bankAccounts.map(bank => [
        bank,
        formatCurrency(bankDetails[bank].initialBalance),
        formatCurrency(bankDetails[bank].income),
        formatCurrency(bankDetails[bank].expenses),
        formatCurrency(bankDetails[bank].finalBalance)
    ]);

    const totalInitial = Object.values(bankDetails).reduce((sum, b) => sum + b.initialBalance, 0);
    const totalFinal = Object.values(bankDetails).reduce((sum, b) => sum + b.finalBalance, 0);

    bankTableData.push([
        'TOTALES',
        formatCurrency(totalInitial),
        formatCurrency(totalIncome),
        formatCurrency(totalExpenses),
        formatCurrency(totalFinal)
    ]);

    doc.text(`Detalle de Movimientos por Banco`, 14, doc.lastAutoTable.finalY + 10);

    doc.autoTable({
        startY: doc.lastAutoTable.finalY + 15,
        head: [['Banco / Fuente', 'Saldo Anterior', 'Entradas (+)', 'Salidas (-)', 'Saldo Final']],
        body: bankTableData,
        theme: 'striped',
        headStyles: { fillColor: [22, 160, 133] },
        footStyles: { fillColor: [200, 200, 200], textColor: [0, 0, 0], fontStyle: 'bold' },
        styles: { fontSize: 10, halign: 'right' },
        columnStyles: { 0: { halign: 'left', fontStyle: 'bold' } }
    });

    // TABLA 3: Mensual
    const monthlyData = [];
    let currentDate = new Date(startDate);

    while (currentDate <= endDate) {
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth();
        const monthName = monthNames[month];

        const mSales = allPayments.filter(p => {
            const d = new Date(p.date); return d.getMonth() === month && d.getFullYear() === year;
        }).reduce((sum, p) => sum + p.amount, 0);

        const mExpenses = allGastos.filter(g => {
            const d = new Date(g.fecha); return d.getMonth() === month && d.getFullYear() === year;
        }).reduce((sum, g) => sum + g.valorTotal, 0);

        const mProfit = mSales - mExpenses;

        const endOfThisMonth = new Date(year, month + 1, 0, 23, 59, 59);
        const carteraAtEndOfMonth = allRemisiones.filter(r =>
            new Date(r.fechaRecibido) <= endOfThisMonth && r.estado !== 'Anulada'
        ).reduce((sum, r) => {
            const pagosHastaFecha = (r.payments || [])
                .filter(p => new Date(p.date) <= endOfThisMonth)
                .reduce((s, p) => s + p.amount, 0);
            const saldo = r.valorTotal - pagosHastaFecha;
            return sum + (saldo > 0 ? saldo : 0);
        }, 0);

        monthlyData.push([
            `${monthName} ${year}`,
            formatCurrency(mSales),
            formatCurrency(mExpenses),
            formatCurrency(mProfit),
            formatCurrency(carteraAtEndOfMonth)
        ]);

        currentDate.setMonth(currentDate.getMonth() + 1);
    }

    doc.text(`Evolución Mensual`, 14, doc.lastAutoTable.finalY + 10);

    doc.autoTable({
        startY: doc.lastAutoTable.finalY + 15,
        head: [['Mes', 'Ventas', 'Gastos', 'Utilidad', 'Cartera al Cierre']],
        body: monthlyData,
        theme: 'grid',
        headStyles: { fillColor: [44, 62, 80] },
        styles: { fontSize: 10, halign: 'right' },
        columnStyles: { 0: { halign: 'left' } }
    });

    doc.save(`Reporte-Financiero-Completo-${startYear}_${startMonth + 1}-a-${endYear}_${endMonth + 1}.pdf`);
}

function showAdminEditUserModal(user) {
    const modalContentWrapper = document.getElementById('modal-content-wrapper');
    const userPermissions = user.permissions || {};

    let permissionsHTML = ALL_MODULES.filter(m => m !== 'empleados').map(module => {
        const isChecked = userPermissions[module] || false;
        const capitalized = module.charAt(0).toUpperCase() + module.slice(1);
        return `
                <label class="flex items-center space-x-2">
                    <input type="checkbox" class="permission-checkbox h-4 w-4 rounded border-gray-300" data-module="${module}" ${isChecked ? 'checked' : ''}>
                    <span>${capitalized}</span>
                </label>
            `;
    }).join('');

    modalContentWrapper.innerHTML = `
            <div class="bg-white rounded-lg p-6 shadow-xl max-w-lg w-full mx-auto text-left">
                <div class="flex justify-between items-center mb-4">
                    <h2 class="text-xl font-semibold">Gestionar Empleado: ${user.nombre}</h2>
                    <button id="close-admin-edit-modal" class="text-gray-500 hover:text-gray-800 text-3xl">&times;</button>
                </div>
                <form id="admin-edit-user-form" class="space-y-4">
                    <input type="hidden" id="admin-edit-user-id" value="${user.id}">
                    <div><label class="block text-sm font-medium">Nombre Completo</label><input type="text" id="admin-edit-name" class="w-full p-2 border rounded-lg mt-1" value="${user.nombre || ''}" required></div>
                    <div><label class="block text-sm font-medium">Correo Electrónico</label><input type="email" id="admin-edit-email" class="w-full p-2 border rounded-lg mt-1" value="${user.email || ''}" required></div>
                    <div><label class="block text-sm font-medium">Teléfono</label><input type="tel" id="admin-edit-phone" class="w-full p-2 border rounded-lg mt-1" value="${user.telefono || ''}"></div>
                    <div><label class="block text-sm font-medium">Dirección</label><input type="text" id="admin-edit-address" class="w-full p-2 border rounded-lg mt-1" value="${user.direccion || ''}"></div>
                    <div><label class="block text-sm font-medium">Fecha de Nacimiento</label><input type="date" id="admin-edit-dob" class="w-full p-2 border rounded-lg mt-1" value="${user.dob || ''}"></div>
                    <div>
                        <label class="block text-sm font-medium">Rol</label>
                        <select id="admin-edit-role-select" class="w-full p-2 border rounded-lg mt-1 bg-white">
                            <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Administrador</option>
                            <option value="facturador" ${user.role === 'facturador' ? 'selected' : ''}>Facturador</option>
                            <option value="planta" ${user.role === 'planta' ? 'selected' : ''}>Planta</option>
                            <option value="employee" ${user.role === 'employee' ? 'selected' : ''}>Empleado</option>
                        </select>
                    </div>
                    <div id="admin-edit-permissions-container">
                        <label class="block text-sm font-medium mb-2">Permisos de Módulos</label>
                        <div class="grid grid-cols-2 gap-2">
                            ${permissionsHTML}
                        </div>
                    </div>
                    <div class="flex justify-end pt-4">
                        <button type="submit" class="w-full bg-indigo-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-indigo-700">Guardar Cambios</button>
                    </div>
                </form>
            </div>
        `;

    const roleSelect = document.getElementById('admin-edit-role-select');
    const permissionsContainer = document.getElementById('admin-edit-permissions-container');

    function togglePermissionsUI(role) {
        permissionsContainer.style.display = (role === 'admin') ? 'none' : 'block';
    }

    roleSelect.addEventListener('change', (e) => togglePermissionsUI(e.target.value));
    togglePermissionsUI(user.role);

    document.getElementById('modal').classList.remove('hidden');
    document.getElementById('close-admin-edit-modal').addEventListener('click', hideModal);
    document.getElementById('admin-edit-user-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const userId = document.getElementById('admin-edit-user-id').value;
        const newRole = document.getElementById('admin-edit-role-select').value;
        const newPermissions = {};

        document.querySelectorAll('#admin-edit-permissions-container .permission-checkbox').forEach(cb => {
            newPermissions[cb.dataset.module] = cb.checked;
        });

        const updatedData = {
            nombre: document.getElementById('admin-edit-name').value,
            email: document.getElementById('admin-edit-email').value,
            telefono: document.getElementById('admin-edit-phone').value,
            direccion: document.getElementById('admin-edit-address').value,
            dob: document.getElementById('admin-edit-dob').value,
            role: newRole,
            permissions: (newRole === 'admin') ? {} : newPermissions
        };

        showModalMessage("Guardando cambios...", true);
        try {
            await updateDoc(doc(db, "users", userId), updatedData);
            // Note: Updating email in Firebase Auth is a sensitive operation and requires re-authentication.
            // It's safer to only update it in Firestore from an admin panel.
            hideModal();
            showModalMessage("Datos del empleado actualizados.", false, 2000);
        } catch (error) {
            console.error("Error al actualizar empleado:", error);
            showModalMessage("Error al guardar los cambios.");
        }
    });
}

/**
 * Muestra el modal para editar el perfil del usuario actual, con campos deshabilitados
 * según el rol del usuario.
 */
function showEditProfileModal() {
    const user = currentUserData;
    if (!user) return;

    const isAdmin = user.role?.toLowerCase() === 'admin';
    const disabledAttribute = isAdmin ? '' : 'disabled';
    const disabledClasses = isAdmin ? '' : 'bg-gray-100 cursor-not-allowed';

    const modalContentWrapper = document.getElementById('modal-content-wrapper');
    modalContentWrapper.innerHTML = `
        <div class="bg-white rounded-lg p-6 shadow-xl max-w-lg w-full mx-auto text-left">
            <div class="flex justify-between items-center mb-4">
                <h2 class="text-xl font-semibold">Editar Mi Perfil</h2>
                <button id="close-profile-modal" class="text-gray-500 hover:text-gray-800 text-3xl">&times;</button>
            </div>
            <form id="edit-profile-form" class="space-y-4">
                <div>
                    <label for="profile-name" class="block text-sm font-medium">Nombre Completo</label>
                    <input type="text" id="profile-name" class="w-full p-2 border rounded-lg mt-1 ${disabledClasses}" value="${user.nombre || ''}" required ${disabledAttribute}>
                </div>
                <div>
                    <label for="profile-cedula" class="block text-sm font-medium">Cédula</label>
                    <input type="text" id="profile-cedula" class="w-full p-2 border rounded-lg mt-1 ${disabledClasses}" value="${user.cedula || ''}" required ${disabledAttribute}>
                </div>
                <div>
                    <label for="profile-dob" class="block text-sm font-medium">Fecha de Nacimiento</label>
                    <input type="date" id="profile-dob" class="w-full p-2 border rounded-lg mt-1 ${disabledClasses}" value="${user.dob || ''}" required ${disabledAttribute}>
                </div>
                <hr/>
                <div>
                    <label for="profile-phone" class="block text-sm font-medium">Celular</label>
                    <input type="tel" id="profile-phone" class="w-full p-2 border rounded-lg mt-1" value="${user.telefono || ''}" required>
                </div>
                <div>
                    <label for="profile-address" class="block text-sm font-medium">Dirección</label>
                    <input type="text" id="profile-address" class="w-full p-2 border rounded-lg mt-1" value="${user.direccion || ''}">
                </div>
                <div>
                    <label for="profile-email" class="block text-sm font-medium">Correo Electrónico</label>
                    <input type="email" id="profile-email" class="w-full p-2 border rounded-lg mt-1" value="${user.email || ''}" required>
                    <p class="text-xs text-gray-500 mt-1">Cambiar tu correo requiere que vuelvas a iniciar sesión.</p>
                </div>
                <div class="flex justify-end pt-4">
                    <button type="submit" class="w-full bg-indigo-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-indigo-700">Guardar Cambios</button>
                </div>
            </form>
        </div>`;

    document.getElementById('modal').classList.remove('hidden');
    document.getElementById('close-profile-modal').addEventListener('click', hideModal);

    document.getElementById('edit-profile-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const newEmail = document.getElementById('profile-email').value;

        // Objeto base con los campos que todos pueden editar
        let updatedData = {
            telefono: document.getElementById('profile-phone').value,
            direccion: document.getElementById('profile-address').value,
            email: newEmail
        };

        // Si el usuario es admin, añadir los campos restringidos
        if (isAdmin) {
            updatedData.nombre = document.getElementById('profile-name').value;
            updatedData.cedula = document.getElementById('profile-cedula').value;
            updatedData.dob = document.getElementById('profile-dob').value;
        }

        showModalMessage("Guardando cambios...", true);
        try {
            await updateDoc(doc(db, "users", currentUser.uid), updatedData);

            if (currentUser.email !== newEmail) {
                await updateEmail(auth.currentUser, newEmail);
            }

            hideModal();
            showModalMessage("Perfil actualizado con éxito.", false, 2000);
        } catch (error) {
            console.error("Error al actualizar perfil:", error);
            let errorMessage = "Error al guardar los cambios.";
            if (error.code === 'auth/requires-recent-login') {
                errorMessage = "Para cambiar tu correo, debes cerrar sesión y volver a entrar por seguridad."
            }
            showModalMessage(errorMessage);
        }
    });
}

/**
 * Renderiza la pestaña de Contratación en el modal de RRHH, incluyendo el filtro por año.
 * @param {object} empleado - El objeto del empleado.
 * @param {HTMLElement} container - El elemento contenedor de la vista.
 */
function renderContratacionTab(empleado, container) {
    const contratacionData = empleado.contratacion || {};

    // **** LÓGICA CORREGIDA PARA OBTENER LOS AÑOS ****
    // 1. Obtener los años donde hay datos de documentos.
    const yearsWithData = Object.keys(contratacionData).filter(key => !isNaN(parseInt(key)));
    // 2. Obtener el año actual.
    const currentYear = new Date().getFullYear().toString();
    // 3. Usar un Set para combinar y eliminar duplicados, luego convertir a array y ordenar.
    const availableYears = [...new Set([currentYear, ...yearsWithData])].sort((a, b) => b - a);

    const selectedYear = availableYears[0];
    let yearOptions = availableYears.map(year => `<option value="${year}" ${year === selectedYear ? 'selected' : ''}>${year}</option>`).join('');

    container.innerHTML = `
        <form id="contratacion-form">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div class="space-y-4">
                    <h3 class="text-lg font-semibold border-b pb-2">Información Laboral</h3>
                    <div><label class="block text-sm font-medium">Fecha de Ingreso</label><input type="date" id="rrhh-fechaIngreso" class="w-full p-2 border rounded-lg mt-1" value="${contratacionData.fechaIngreso || ''}"></div>
                    <div><label class="block text-sm font-medium">Salario</label><input type="text" id="rrhh-salario" class="w-full p-2 border rounded-lg mt-1" value="${contratacionData.salario ? formatCurrency(contratacionData.salario) : ''}"></div>
                    <div><label class="block text-sm font-medium">EPS</label><input type="text" id="rrhh-eps" class="w-full p-2 border rounded-lg mt-1" value="${contratacionData.eps || ''}"></div>
                    <div><label class="block text-sm font-medium">AFP</label><input type="text" id="rrhh-afp" class="w-full p-2 border rounded-lg mt-1" value="${contratacionData.afp || ''}"></div>
                </div>
                <div class="space-y-4">
                    <div class="flex flex-col sm:flex-row justify-between sm:items-center border-b pb-2 gap-2">
                        <h3 class="text-lg font-semibold">Documentos</h3>
                        <div class="flex items-center gap-2">
                            <label for="rrhh-year-filter" class="text-sm font-medium">Año:</label>
                            <select id="rrhh-year-filter" class="p-1 border rounded-lg bg-white">${yearOptions}</select>
                            <button type="button" id="download-all-docs-btn" class="bg-green-600 text-white font-bold py-1 px-3 rounded-lg hover:bg-green-700 text-sm">Descargar Todo</button>
                        </div>
                    </div>
                    <div id="rrhh-documents-list" class="border rounded-lg"></div>
                </div>
            </div>
            <div class="flex justify-end mt-6">
                <button type="submit" class="bg-indigo-600 text-white font-bold py-2 px-6 rounded-lg hover:bg-indigo-700">Guardar Información</button>
            </div>
        </form>
    `;

    renderDocumentList(empleado, selectedYear);

    document.getElementById('rrhh-year-filter').addEventListener('change', (e) => {
        renderDocumentList(empleado, e.target.value);
    });

    const salarioInput = document.getElementById('rrhh-salario');
    if (salarioInput) {
        salarioInput.addEventListener('focus', (e) => unformatCurrencyInput(e.target));
        salarioInput.addEventListener('blur', (e) => formatCurrencyInput(e.target));
    }

    const contratacionForm = document.getElementById('contratacion-form');
    if (contratacionForm) {
        contratacionForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const updatedData = {
                "contratacion.fechaIngreso": document.getElementById('rrhh-fechaIngreso').value,
                "contratacion.salario": unformatCurrency(document.getElementById('rrhh-salario').value),
                "contratacion.eps": document.getElementById('rrhh-eps').value,
                "contratacion.afp": document.getElementById('rrhh-afp').value
            };
            showTemporaryMessage("Guardando datos...", "info");
            try {
                await updateDoc(doc(db, "users", empleado.id), updatedData);
                showTemporaryMessage("Datos guardados con éxito.", "success");
            } catch (error) {
                console.error("Error al guardar datos:", error);
                showTemporaryMessage("Error al guardar los datos.", "error");
            }
        });
    }

    document.getElementById('download-all-docs-btn').addEventListener('click', () => {
        const selectedYear = document.getElementById('rrhh-year-filter').value;
        downloadAllDocsAsZip(empleado, selectedYear);
    });
}


/**
 * Renderiza únicamente la lista de documentos para un año específico.
 * @param {object} empleado - El objeto del empleado.
 * @param {string} year - El año seleccionado para filtrar los documentos.
 */
function renderDocumentList(empleado, year) {
    const documentsListContainer = document.getElementById('rrhh-documents-list');
    if (!documentsListContainer) return;

    const contratacionData = empleado.contratacion || {};
    const documentosDelAnio = contratacionData[year]?.documentos || {};

    let documentsHTML = RRHH_DOCUMENT_TYPES.map(docType => {
        const docUrl = documentosDelAnio[docType.id];
        const fileInputId = `file-rrhh-${docType.id}-${empleado.id}`;
        return `
            <div class="flex justify-between items-center p-3 border-b">
                <span class="font-medium">${docType.name}</span>
                <div class="flex items-center gap-2">
                    ${docUrl ? `<button type="button" data-pdf-url="${docUrl}" data-doc-name="${docType.name}" class="view-rrhh-pdf-btn bg-blue-500 text-white px-3 py-1 rounded-lg text-sm hover:bg-blue-600">Ver</button>` : '<span class="text-xs text-gray-400">No adjunto</span>'}
                    <input type="file" id="${fileInputId}" class="hidden" accept=".pdf,.jpg,.jpeg,.png">
                    <label for="${fileInputId}" class="bg-gray-200 text-gray-700 px-3 py-1 rounded-lg text-sm font-semibold cursor-pointer hover:bg-gray-300">Adjuntar</label>
                </div>
            </div>
        `;
    }).join('');

    documentsListContainer.innerHTML = documentsHTML;

    documentsListContainer.querySelectorAll('.view-rrhh-pdf-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            showPdfModal(e.currentTarget.dataset.pdfUrl, e.currentTarget.dataset.docName);
        });
    });

    RRHH_DOCUMENT_TYPES.forEach(docType => {
        const fileInput = documentsListContainer.querySelector(`#file-rrhh-${docType.id}-${empleado.id}`);
        if (fileInput) {
            fileInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (file) {
                    const selectedYear = document.getElementById('rrhh-year-filter').value;
                    const docPath = `contratacion.${selectedYear}.documentos.${docType.id}`;
                    handleFileUpload(empleado.id, docPath, file);
                }
            });
        }
    });
}

function renderPagosTab(empleado, container) {
    const salario = empleado.contratacion?.salario || 0;
    const pagos = empleado.pagos || [];

    const pagosHTML = pagos.length > 0 ? pagos.slice().sort((a, b) => new Date(b.fecha) - new Date(a.fecha)).map(p => `
            <tr class="border-b">
                <td class="p-2">${p.fecha}</td>
                <td class="p-2">${p.motivo}</td>
                <td class="p-2 text-right">${formatCurrency(p.valor)}</td>
                <td class="p-2">${p.fuentePago}</td>
            </tr>
        `).join('') : '<tr><td colspan="4" class="p-4 text-center text-gray-500">No hay pagos registrados.</td></tr>';

    // Fetch and render pending loans
    const q = query(collection(db, "prestamos"), where("employeeId", "==", empleado.id), where("status", "==", "aprobado"));
    getDocs(q).then(snapshot => {
        const prestamos = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        const prestamosContainer = container.querySelector('#prestamos-pendientes-container');
        if (prestamosContainer) {
            if (prestamos.length > 0) {
                prestamosContainer.innerHTML = `
                        <h4 class="font-semibold text-md mb-2">Préstamos Pendientes de Cobro</h4>
                        <div class="space-y-2">
                            ${prestamos.map(p => `
                                <div class="bg-yellow-100 p-3 rounded-lg flex justify-between items-center">
                                    <div>
                                        <p class="font-semibold">${formatCurrency(p.amount)}</p>
                                        <p class="text-xs text-yellow-800">${p.reason}</p>
                                    </div>
                                    <button data-loan-id="${p.id}" class="cobrar-prestamo-btn bg-yellow-500 text-white text-xs px-3 py-1 rounded-full hover:bg-yellow-600">Marcar Cancelado</button>
                                </div>
                            `).join('')}
                        </div>`;
                prestamosContainer.querySelectorAll('.cobrar-prestamo-btn').forEach(btn => {
                    btn.addEventListener('click', async (e) => {
                        const loanId = e.currentTarget.dataset.loanId;
                        if (confirm("¿Estás seguro de que quieres marcar este préstamo como cancelado?")) {
                            await handleLoanAction(loanId, 'cancelado');
                        }
                    });
                });
            } else {
                prestamosContainer.innerHTML = '';
            }
        }
    });

    container.innerHTML = `
            <div class="grid grid-cols-1 md:grid-cols-3 gap-6 h-full"> <div class="md:col-span-1 space-y-4">
                     <div class="bg-gray-50 p-4 rounded-lg">
                        <h3 class="text-lg font-semibold mb-2">Liquidador Horas Extra</h3>
                        <div class="space-y-2">
                            <div><label class="text-sm">Salario Base (sin auxilio)</label><input type="text" id="salario-base-he" class="w-full p-2 border bg-gray-200 rounded-lg mt-1" value="${formatCurrency(salario > 200000 ? salario - 200000 : 0)}" readonly></div>
                            <div><label for="horas-extra-input" class="text-sm">Cantidad de Horas Extra</label><input type="number" id="horas-extra-input" class="w-full p-2 border rounded-lg mt-1" min="0"></div>
                            <button id="calcular-horas-btn" class="w-full bg-blue-500 text-white font-semibold py-2 rounded-lg hover:bg-blue-600">Calcular</button>
                            <div id="horas-extra-resultado" class="text-center font-bold text-xl mt-2 p-2 bg-blue-100 rounded-lg"></div>
                        </div>
                    </div>
                    <div class="bg-gray-50 p-4 rounded-lg">
                        <h3 class="text-lg font-semibold mb-2">Registrar Nuevo Pago</h3>
                        <form id="rrhh-pago-form" class="space-y-3">
                            <div id="prestamos-pendientes-container" class="mb-4"></div>
                            <div><label class="text-sm">Motivo</label><select id="rrhh-pago-motivo" class="w-full p-2 border rounded-lg mt-1 bg-white"><option>Sueldo</option><option>Prima</option><option>Horas Extra</option><option>Liquidación</option></select></div>
                            <div>
                                <label class="text-sm">Valor</label>
                                <input type="text" id="rrhh-pago-valor" class="w-full p-2 border rounded-lg mt-1" required>
                                <p id="pago-sugerido-info" class="text-xs text-gray-500 mt-1 hidden">Valor quincenal sugerido (salario/2 - aportes).</p>
                            </div>
                            <div><label class="text-sm">Fecha</label><input type="date" id="rrhh-pago-fecha" class="w-full p-2 border rounded-lg mt-1" value="${new Date().toISOString().split('T')[0]}" required></div>
                            <div><label class="text-sm">Fuente de Pago</label><select id="rrhh-pago-fuente" class="w-full p-2 border rounded-lg mt-1 bg-white"><option>Efectivo</option><option>Nequi</option><option>Davivienda</option></select></div>
                            <button type="submit" class="w-full bg-green-600 text-white font-semibold py-2 rounded-lg hover:bg-green-700">Registrar Pago</button>
                        </form>
                    </div>
                </div>
                <div class="md:col-span-2 flex flex-col h-full">
                    <h3 class="text-lg font-semibold mb-2 flex-shrink-0">Historial de Pagos</h3>
                    <div class="border rounded-lg h-[60vh] overflow-y-auto bg-white shadow-inner">
                        <table class="w-full text-sm">
                            <thead class="bg-gray-100 sticky top-0 shadow-sm"> <tr><th class="p-2 text-left">Fecha</th><th class="p-2 text-left">Motivo</th><th class="p-2 text-right">Valor</th><th class="p-2 text-left">Fuente</th></tr>
                            </thead>
                            <tbody id="rrhh-pagos-historial">${pagosHTML}</tbody>
                        </table>
                    </div>
                </div>
            </div>
        `;

    const valorPagoInput = document.getElementById('rrhh-pago-valor');
    const motivoPagoSelect = document.getElementById('rrhh-pago-motivo');
    const pagoSugeridoInfo = document.getElementById('pago-sugerido-info');

    valorPagoInput.addEventListener('focus', (e) => unformatCurrencyInput(e.target));
    valorPagoInput.addEventListener('blur', (e) => formatCurrencyInput(e.target));

    motivoPagoSelect.addEventListener('change', (e) => {
        if (e.target.value === 'Sueldo') {
            if (salario > 0) {
                const pagoQuincenal = (salario / 2) - 56940;
                valorPagoInput.value = pagoQuincenal > 0 ? pagoQuincenal : 0;
                formatCurrencyInput(valorPagoInput);
                pagoSugeridoInfo.classList.remove('hidden');
            } else {
                valorPagoInput.value = '';
                valorPagoInput.placeholder = 'Definir salario primero';
                pagoSugeridoInfo.classList.add('hidden');
            }
        } else {
            valorPagoInput.value = '';
            valorPagoInput.placeholder = '';
            pagoSugeridoInfo.classList.add('hidden');
        }
    });

    motivoPagoSelect.dispatchEvent(new Event('change'));

    document.getElementById('calcular-horas-btn').addEventListener('click', () => {
        const horas = parseFloat(document.getElementById('horas-extra-input').value) || 0;
        if (salario > 0) {
            const salarioBase = salario > 200000 ? salario - 200000 : salario;
            const valorHoraNormal = salarioBase / 240;
            const valorHoraExtra = valorHoraNormal * 1.25;
            const totalPagar = valorHoraExtra * horas;
            document.getElementById('horas-extra-resultado').textContent = formatCurrency(totalPagar);
        } else {
            document.getElementById('horas-extra-resultado').textContent = "Salario no definido.";
        }
    });

    document.getElementById('rrhh-pago-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const nuevoPago = {
            motivo: document.getElementById('rrhh-pago-motivo').value,
            valor: unformatCurrency(document.getElementById('rrhh-pago-valor').value),
            fecha: document.getElementById('rrhh-pago-fecha').value,
            fuentePago: document.getElementById('rrhh-pago-fuente').value,
            timestamp: new Date().toISOString()
        };

        if (nuevoPago.valor <= 0) {
            showModalMessage("El valor del pago debe ser mayor a cero.");
            return;
        }

        showModalMessage("Registrando pago...", true);
        try {
            await updateDoc(doc(db, "users", empleado.id), {
                pagos: arrayUnion(nuevoPago)
            });

            const nuevoGasto = {
                fecha: nuevoPago.fecha,
                proveedorId: empleado.id,
                proveedorNombre: `Empleado: ${empleado.nombre} (${nuevoPago.motivo})`,
                numeroFactura: `Pago RRHH`,
                valorTotal: nuevoPago.valor,
                fuentePago: nuevoPago.fuentePago,
                registradoPor: currentUser.uid,
                timestamp: new Date(),
                isEmployeePayment: true
            };
            await addDoc(collection(db, "gastos"), nuevoGasto);

            const statsRef = doc(db, "estadisticas", "globales");
            await actualizarSaldoPorGasto(nuevoGasto.fuentePago, nuevoGasto.valorTotal);

            showModalMessage("Pago registrado y añadido a gastos.", false, 2500);
            e.target.reset();
            motivoPagoSelect.dispatchEvent(new Event('change'));
            const resultadoHoras = document.getElementById('horas-extra-resultado');
            if (resultadoHoras) resultadoHoras.textContent = '';
        } catch (error) {
            console.error("Error al registrar pago:", error);
            showModalMessage("Error al registrar el pago.");
        }
    });
}

function renderDescargosTab(empleado, container) {
    const descargos = empleado.descargos || [];

    const descargosHTML = descargos.length > 0
        ? descargos.slice().sort((a, b) => new Date(b.fecha) - new Date(a.fecha)).map((d, index) => `
                <div class="border p-4 rounded-lg">
                    <div class="flex justify-between items-start">
                        <div>
                            <p class="font-semibold">${d.motivo}</p>
                            <p class="text-sm text-gray-500">Fecha: ${d.fecha}</p>
                        </div>
                        <div class="flex items-center gap-2">
                            ${d.citacionUrl ? `<button type="button" data-pdf-url="${d.citacionUrl}" data-doc-name="Citación" class="view-rrhh-pdf-btn text-sm bg-blue-100 text-blue-700 px-2 py-1 rounded-full hover:bg-blue-200">Citación</button>` : ''}
                            ${d.actaUrl ? `<button type="button" data-pdf-url="${d.actaUrl}" data-doc-name="Acta" class="view-rrhh-pdf-btn text-sm bg-blue-100 text-blue-700 px-2 py-1 rounded-full hover:bg-blue-200">Acta</button>` : ''}
                            ${d.conclusionUrl ? `<button type="button" data-pdf-url="${d.conclusionUrl}" data-doc-name="Conclusión" class="view-rrhh-pdf-btn text-sm bg-blue-100 text-blue-700 px-2 py-1 rounded-full hover:bg-blue-200">Conclusión</button>` : ''}
                        </div>
                    </div>
                </div>
            `).join('')
        : '<p class="text-center text-gray-500 py-4">No hay descargos registrados.</p>';

    container.innerHTML = `
            <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div class="md:col-span-1">
                    <div class="bg-gray-50 p-4 rounded-lg">
                        <h3 class="text-lg font-semibold mb-2">Registrar Descargo</h3>
                        <form id="descargos-form" class="space-y-4">
                            <div><label for="descargo-fecha" class="text-sm font-medium">Fecha de Reunión</label><input type="date" id="descargo-fecha" class="w-full p-2 border rounded-lg mt-1" required></div>
                            <div><label for="descargo-motivo" class="text-sm font-medium">Motivo de Reunión</label><textarea id="descargo-motivo" class="w-full p-2 border rounded-lg mt-1" rows="3" required></textarea></div>
                            <div><label for="descargo-citacion" class="text-sm font-medium">Citación a descargos (PDF)</label><input type="file" id="descargo-citacion" class="w-full text-sm" accept=".pdf"></div>
                            <div><label for="descargo-acta" class="text-sm font-medium">Acta de descargos (PDF)</label><input type="file" id="descargo-acta" class="w-full text-sm" accept=".pdf"></div>
                            <div><label for="descargo-conclusion" class="text-sm font-medium">Conclusión de descargos (PDF)</label><input type="file" id="descargo-conclusion" class="w-full text-sm" accept=".pdf"></div>
                            <button type="submit" class="w-full bg-purple-600 text-white font-semibold py-2 rounded-lg hover:bg-purple-700">Guardar Descargo</button>
                        </form>
                    </div>
                </div>
                <div class="md:col-span-2">
                     <h3 class="text-lg font-semibold mb-2">Historial de Descargos</h3>
                     <div class="space-y-3">${descargosHTML}</div>
                </div>
            </div>
        `;

    document.querySelectorAll('.view-rrhh-pdf-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const pdfUrl = e.currentTarget.dataset.pdfUrl;
            const docName = e.currentTarget.dataset.docName;
            showPdfModal(pdfUrl, docName);
        });
    });

    document.getElementById('descargos-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fecha = document.getElementById('descargo-fecha').value;
        const motivo = document.getElementById('descargo-motivo').value;
        const citacionFile = document.getElementById('descargo-citacion').files[0];
        const actaFile = document.getElementById('descargo-acta').files[0];
        const conclusionFile = document.getElementById('descargo-conclusion').files[0];

        showModalMessage("Guardando descargo y subiendo archivos...", true);

        try {
            const timestamp = Date.now();
            const uploadPromises = [];
            const fileData = {};

            if (citacionFile) {
                const citacionRef = ref(storage, `empleados/${empleado.id}/descargos/${timestamp}_citacion.pdf`);
                uploadPromises.push(uploadBytes(citacionRef, citacionFile).then(snap => getDownloadURL(snap.ref)).then(url => fileData.citacionUrl = url));
            }
            if (actaFile) {
                const actaRef = ref(storage, `empleados/${empleado.id}/descargos/${timestamp}_acta.pdf`);
                uploadPromises.push(uploadBytes(actaRef, actaFile).then(snap => getDownloadURL(snap.ref)).then(url => fileData.actaUrl = url));
            }
            if (conclusionFile) {
                const conclusionRef = ref(storage, `empleados/${empleado.id}/descargos/${timestamp}_conclusion.pdf`);
                uploadPromises.push(uploadBytes(conclusionRef, conclusionFile).then(snap => getDownloadURL(snap.ref)).then(url => fileData.conclusionUrl = url));
            }

            await Promise.all(uploadPromises);

            const nuevoDescargo = {
                fecha,
                motivo,
                ...fileData,
                timestamp: new Date().toISOString()
            };

            await updateDoc(doc(db, "users", empleado.id), {
                descargos: arrayUnion(nuevoDescargo)
            });

            e.target.reset();
            showModalMessage("Descargo registrado con éxito.", false, 2000);

        } catch (error) {
            console.error("Error al registrar descargo:", error);
            showModalMessage("Error al guardar el descargo.");
        }
    });
}

/**
 * Renderiza la pestaña de Préstamos en el modal de RRHH, incluyendo los filtros.
 * @param {object} empleado - El objeto del empleado.
 * @param {HTMLElement} container - El elemento contenedor de la vista.
 */
function renderPrestamosTab(empleado, container) {
    const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    let monthOptions = monthNames.map((month, i) => `<option value="${i}" ${i === currentMonth ? 'selected' : ''}>${month}</option>`).join('');
    let yearOptions = '';
    for (let i = 0; i < 5; i++) {
        const year = currentYear - i;
        yearOptions += `<option value="${year}">${year}</option>`;
    }

    container.innerHTML = `
        <div class="space-y-4">
            <div class="bg-gray-50 p-3 rounded-lg border">
                <h3 class="font-semibold mb-2">Filtrar Préstamos</h3>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                        <label class="block text-sm font-medium mb-1">Filtrar por Mes</label>
                        <div class="flex gap-2">
                            <select id="loan-month-filter" class="p-2 border rounded-lg bg-white w-full">${monthOptions}</select>
                            <select id="loan-year-filter" class="p-2 border rounded-lg bg-white w-full">${yearOptions}</select>
                        </div>
                    </div>
                    <div>
                        <label class="block text-sm font-medium mb-1">Filtrar por Rango</label>
                        <div class="flex gap-2 items-center">
                            <input type="date" id="loan-start-date" class="p-2 border rounded-lg w-full">
                            <span class="text-gray-500">-</span>
                            <input type="date" id="loan-end-date" class="p-2 border rounded-lg w-full">
                        </div>
                    </div>
                </div>
            </div>
            <div>
                <h3 class="text-lg font-semibold mb-2">Solicitudes de Préstamo</h3>
                <div id="rrhh-prestamos-list" class="space-y-3">Cargando...</div>
            </div>
        </div>
    `;

    const monthFilter = document.getElementById('loan-month-filter');
    const yearFilter = document.getElementById('loan-year-filter');
    const startDateFilter = document.getElementById('loan-start-date');
    const endDateFilter = document.getElementById('loan-end-date');

    const filterLoans = async () => {
        const startDate = startDateFilter.value;
        const endDate = endDateFilter.value;
        const month = monthFilter.value;
        const year = yearFilter.value;
        let prestamosQuery;

        if (startDate && endDate) {
            // Filtro por rango
            prestamosQuery = query(
                collection(db, "prestamos"),
                where("employeeId", "==", empleado.id),
                where("requestDate", ">=", startDate),
                where("requestDate", "<=", endDate)
            );
        } else {
            // Filtro por mes (calcula el primer y último día del mes)
            const firstDay = new Date(year, month, 1).toISOString().split('T')[0];
            const lastDay = new Date(year, parseInt(month) + 1, 0).toISOString().split('T')[0];
            prestamosQuery = query(
                collection(db, "prestamos"),
                where("employeeId", "==", empleado.id),
                where("requestDate", ">=", firstDay),
                where("requestDate", "<=", lastDay)
            );
        }

        const snapshot = await getDocs(prestamosQuery);
        const prestamos = snapshot.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => new Date(b.requestDate) - new Date(a.requestDate));
        renderLoanList(prestamos);
    };

    // Listeners para los filtros
    monthFilter.addEventListener('change', () => {
        startDateFilter.value = '';
        endDateFilter.value = '';
        filterLoans();
    });
    yearFilter.addEventListener('change', () => {
        startDateFilter.value = '';
        endDateFilter.value = '';
        filterLoans();
    });
    endDateFilter.addEventListener('change', () => {
        if (startDateFilter.value) {
            monthFilter.value = now.getMonth(); // Resetea el filtro de mes
            yearFilter.value = now.getFullYear();
            filterLoans();
        }
    });

    // Carga inicial de préstamos para el mes actual
    filterLoans();
}

/**
 * Renderiza la lista de préstamos en el contenedor.
 * @param {Array} prestamos - La lista de préstamos a renderizar.
 */
function renderLoanList(prestamos) {
    const prestamosListEl = document.getElementById('rrhh-prestamos-list');
    if (!prestamosListEl) return;

    if (prestamos.length === 0) {
        prestamosListEl.innerHTML = '<p class="text-center text-gray-500 py-4">No se encontraron préstamos para el filtro seleccionado.</p>';
        return;
    }
    prestamosListEl.innerHTML = '';
    prestamos.forEach(p => {
        const el = document.createElement('div');
        el.className = 'border p-3 rounded-lg';

        let statusBadge = '';
        let actions = '';
        switch (p.status) {
            case 'solicitado':
                statusBadge = `<span class="text-xs font-semibold bg-yellow-200 text-yellow-800 px-2 py-1 rounded-full">Solicitado</span>`;
                actions = `
                    <button data-loan-json='${JSON.stringify(p)}' class="approve-loan-btn bg-green-500 text-white text-xs px-3 py-1 rounded-full hover:bg-green-600">Aprobar</button>
                    <button data-loan-id="${p.id}" data-action="denegado" class="loan-action-btn bg-red-500 text-white text-xs px-3 py-1 rounded-full hover:bg-red-600">Denegar</button>
                `;
                break;
            case 'aprobado':
                statusBadge = `<span class="text-xs font-semibold bg-blue-200 text-blue-800 px-2 py-1 rounded-full">Aprobado</span>`;
                break;
            case 'cancelado':
                statusBadge = `<span class="text-xs font-semibold bg-gray-200 text-gray-800 px-2 py-1 rounded-full">Cancelado</span>`;
                break;
        }
        el.innerHTML = `
            <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center">
                <div>
                    <p class="font-bold text-lg">${formatCurrency(p.amount)}</p>
                    <p class="text-sm text-gray-600">${p.reason}</p>
                    <p class="text-xs text-gray-400">Solicitado el: ${p.requestDate}</p>
                </div>
                <div class="flex items-center gap-2 mt-2 sm:mt-0">
                    ${statusBadge}
                    ${actions}
                </div>
            </div>
        `;
        prestamosListEl.appendChild(el);
    });

    prestamosListEl.querySelectorAll('.approve-loan-btn').forEach(btn => {
        btn.addEventListener('click', (e) => showApproveLoanModal(JSON.parse(e.currentTarget.dataset.loanJson)));
    });
    prestamosListEl.querySelectorAll('.loan-action-btn').forEach(btn => {
        btn.addEventListener('click', (e) => handleLoanAction(e.currentTarget.dataset.loanId, e.currentTarget.dataset.action));
    });
}

function showRRHHModal(empleado) {
    const modalContentWrapper = document.getElementById('modal-content-wrapper');
    let unsubscribe;
    let currentEmpleadoData = empleado;

    modalContentWrapper.innerHTML = `
            <div class="bg-white rounded-lg shadow-xl w-full max-w-5xl mx-auto text-left flex flex-col" style="max-height: 90vh;">
                <div class="flex justify-between items-center p-4 border-b">
                    <h2 class="text-xl font-semibold">Recursos Humanos: ${empleado.nombre}</h2>
                    <button id="close-rrhh-modal" class="text-gray-500 hover:text-gray-800 text-3xl">&times;</button>
                </div>
                <div class="border-b border-gray-200">
                    <nav class="-mb-px flex space-x-6 px-6">
                        <button id="rrhh-tab-contratacion" class="dashboard-tab-btn active py-3 px-1 font-semibold">Datos y Contratación</button>
                        <button id="rrhh-tab-pagos" class="dashboard-tab-btn py-3 px-1 font-semibold">Pagos y Liquidaciones</button>
                        <button id="rrhh-tab-descargos" class="dashboard-tab-btn py-3 px-1 font-semibold">Descargos</button>
                        <button id="rrhh-tab-prestamos" class="dashboard-tab-btn py-3 px-1 font-semibold">Préstamos</button>
                    </nav>
                </div>
                <div class="p-6 overflow-y-auto flex-grow">
                    <div id="rrhh-view-contratacion"></div>
                    <div id="rrhh-view-pagos" class="hidden"></div>
                    <div id="rrhh-view-descargos" class="hidden"></div>
                    <div id="rrhh-view-prestamos" class="hidden"></div>
                </div>
            </div>
        `;
    document.getElementById('modal').classList.remove('hidden');

    const closeBtn = document.getElementById('close-rrhh-modal');
    closeBtn.addEventListener('click', () => {
        if (unsubscribe) unsubscribe();
        hideModal();
    });

    const contratacionTab = document.getElementById('rrhh-tab-contratacion');
    const pagosTab = document.getElementById('rrhh-tab-pagos');
    const descargosTab = document.getElementById('rrhh-tab-descargos');
    const prestamosTab = document.getElementById('rrhh-tab-prestamos');
    const contratacionView = document.getElementById('rrhh-view-contratacion');
    const pagosView = document.getElementById('rrhh-view-pagos');
    const descargosView = document.getElementById('rrhh-view-descargos');
    const prestamosView = document.getElementById('rrhh-view-prestamos');

    const tabs = [contratacionTab, pagosTab, descargosTab, prestamosTab];
    const views = [contratacionView, pagosView, descargosView, prestamosView];

    const switchRrhhTab = (activeIndex) => {
        tabs.forEach((tab, index) => tab.classList.toggle('active', index === activeIndex));
        views.forEach((view, index) => view.classList.toggle('hidden', index !== activeIndex));
    };

    contratacionTab.addEventListener('click', () => switchRrhhTab(0));
    pagosTab.addEventListener('click', () => switchRrhhTab(1));
    descargosTab.addEventListener('click', () => switchRrhhTab(2));
    prestamosTab.addEventListener('click', () => switchRrhhTab(3));

    unsubscribe = onSnapshot(doc(db, "users", empleado.id), (docSnapshot) => {
        if (docSnapshot.exists() && document.getElementById('close-rrhh-modal')) {
            currentEmpleadoData = { id: docSnapshot.id, ...docSnapshot.data() };
            renderContratacionTab(currentEmpleadoData, contratacionView);
            renderPagosTab(currentEmpleadoData, pagosView);
            renderDescargosTab(currentEmpleadoData, descargosView);
            renderPrestamosTab(currentEmpleadoData, prestamosView);
        }
    });
}

async function downloadAllDocsAsZip(empleado) {
    const documentos = empleado.contratacion?.documentos;
    if (!documentos || Object.keys(documentos).length === 0) {
        showModalMessage("Este empleado no tiene documentos para descargar.");
        return;
    }

    showModalMessage("Preparando descarga... Esto puede tardar unos segundos.", true);

    try {
        const zip = new JSZip();
        const promises = [];

        for (const docType in documentos) {
            const url = documentos[docType];
            if (url) {
                const promise = fetch(url)
                    .then(response => {
                        if (!response.ok) {
                            throw new Error(`HTTP error! status: ${response.status}`);
                        }
                        return response.blob();
                    })
                    .then(blob => {
                        const docInfo = RRHH_DOCUMENT_TYPES.find(d => d.id === docType);
                        const docName = docInfo ? docInfo.name.replace(/ /g, '_') : docType;

                        let fileExtension = 'pdf'; // default
                        try {
                            const urlPath = new URL(url).pathname;
                            const extensionMatch = urlPath.match(/\.([^.]+)$/);
                            if (extensionMatch) {
                                fileExtension = extensionMatch[1].split('?')[0];
                            } else {
                                fileExtension = blob.type.split('/')[1] || 'pdf';
                            }
                        } catch (e) {
                            console.warn("No se pudo analizar la URL para la extensión, usando el tipo de blob.", e);
                            fileExtension = blob.type.split('/')[1] || 'pdf';
                        }

                        zip.file(`${docName}.${fileExtension}`, blob);
                    })
                    .catch(error => {
                        console.error(`No se pudo descargar el archivo para ${docType}:`, error);
                        zip.file(`ERROR_${docType}.txt`, `No se pudo descargar el archivo desde la URL.\nError: ${error.message}`);
                    });
                promises.push(promise);
            }
        }

        await Promise.all(promises);

        zip.generateAsync({ type: "blob" }).then(function (content) {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(content);
            a.download = `documentos_${empleado.nombre.replace(/ /g, '_')}.zip`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(a.href);
            hideModal();
        });
    } catch (error) {
        console.error("Error al crear el archivo zip:", error);
        showModalMessage("Error al crear el archivo ZIP.");
    }
}

function showDiscountModal(remision) {
    const modalContentWrapper = document.getElementById('modal-content-wrapper');

    modalContentWrapper.innerHTML = `
            <div class="bg-white rounded-lg p-6 shadow-xl max-w-sm w-full mx-auto text-left">
                <div class="flex justify-between items-center mb-4">
                    <h2 class="text-xl font-semibold">Aplicar Descuento</h2>
                    <button id="close-discount-modal" class="text-gray-500 hover:text-gray-800 text-3xl">&times;</button>
                </div>
                <p class="text-sm text-gray-600 mb-2">Remisión N°: <span class="font-bold">${remision.numeroRemision}</span></p>
                <p class="text-sm text-gray-600 mb-4">Subtotal: <span class="font-bold">${formatCurrency(remision.subtotal)}</span></p>
                <form id="discount-form" class="space-y-4">
                    <div>
                        <label for="discount-amount" class="block text-sm font-medium">Valor del Descuento (COP)</label>
                        <input type="text" id="discount-amount" class="w-full p-2 border rounded-lg mt-1" inputmode="numeric" required placeholder="Ej: 10000">
                        </div>
                    <button type="submit" class="w-full bg-cyan-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-cyan-700">Aplicar Descuento</button>
                </form>
            </div>
        `;
    document.getElementById('modal').classList.remove('hidden');
    document.getElementById('close-discount-modal').addEventListener('click', hideModal);

    const amountInput = document.getElementById('discount-amount');
    amountInput.addEventListener('focus', (e) => unformatCurrencyInput(e.target));
    amountInput.addEventListener('blur', (e) => formatCurrencyInput(e.target));

    document.getElementById('discount-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const discountAmount = unformatCurrency(amountInput.value);

        if (isNaN(discountAmount) || discountAmount <= 0) {
            showModalMessage("Por favor, ingresa un valor de descuento válido.");
            return;
        }

        const discountPercentage = (discountAmount / remision.subtotal) * 100;

        showModalMessage("Aplicando descuento...", true);
        const applyDiscountFn = httpsCallable(functions, 'applyDiscount');
        try {
            const result = await applyDiscountFn({ remisionId: remision.id, discountPercentage: discountPercentage });
            if (result.data.success) {
                hideModal();
                showModalMessage("¡Descuento aplicado con éxito!", false, 2000);
            } else {
                throw new Error(result.data.message || 'Error desconocido');
            }
        } catch (error) {
            console.error("Error al aplicar descuento:", error);
            showModalMessage(`Error: ${error.message}`);
        }
    });
}

function showFacturaModal(remisionId) {
    const modalContentWrapper = document.getElementById('modal-content-wrapper');
    modalContentWrapper.innerHTML = `
            <div class="bg-white rounded-lg p-6 shadow-xl max-w-md w-full mx-auto text-left">
                <div class="flex justify-between items-center mb-4">
                    <h2 class="text-xl font-semibold">Registrar Factura</h2>
                    <button id="close-factura-modal" class="text-gray-500 hover:text-gray-800 text-3xl">&times;</button>
                </div>
                <form id="factura-form" class="space-y-4">
                    <div>
                        <label for="factura-numero" class="block text-sm font-medium">Número de Factura</label>
                        <input type="text" id="factura-numero" class="w-full p-2 border rounded-lg mt-1" required>
                    </div>
                    <div>
                        <label for="factura-pdf" class="block text-sm font-medium">Adjuntar PDF de la Factura</label>
                        <input type="file" id="factura-pdf" class="w-full p-2 border rounded-lg mt-1" accept=".pdf" required>
                    </div>
                    <button type="submit" class="w-full bg-blue-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-blue-700">Marcar como Facturado</button>
                </form>
            </div>
        `;
    document.getElementById('modal').classList.remove('hidden');
    document.getElementById('close-factura-modal').addEventListener('click', hideModal);
    document.getElementById('factura-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const numeroFactura = document.getElementById('factura-numero').value;
        const fileInput = document.getElementById('factura-pdf');
        const file = fileInput.files[0];

        if (!file) {
            showModalMessage("Debes seleccionar un archivo PDF.");
            return;
        }

        showModalMessage("Subiendo factura y actualizando...", true);
        try {
            const storageRef = ref(storage, `facturas/${remisionId}-${file.name}`);
            const snapshot = await uploadBytes(storageRef, file);
            const downloadURL = await getDownloadURL(snapshot.ref);

            await updateDoc(doc(db, "remisiones", remisionId), {
                facturado: true,
                numeroFactura: numeroFactura,
                facturaPdfUrl: downloadURL,
                fechaFacturado: new Date()
            });

            hideModal();
            showModalMessage("¡Remisión facturada con éxito!", false, 2000);
        } catch (error) {
            console.error("Error al facturar:", error);
            showModalMessage("Error al procesar la factura.");
        }
    });
}

// +++ NUEVA FUNCIÓN: Muestra el modal de solicitud de préstamo +++
function showLoanRequestModal() {
    const modalContentWrapper = document.getElementById('modal-content-wrapper');

    modalContentWrapper.innerHTML = `
            <div class="bg-white rounded-lg p-6 shadow-xl max-w-lg w-full mx-auto text-left">
                <div class="flex justify-between items-center mb-4">
                    <h2 class="text-xl font-semibold">Solicitud de Préstamo</h2>
                    <button id="close-loan-modal" class="text-gray-500 hover:text-gray-800 text-3xl">&times;</button>
                </div>
                <form id="loan-request-form" class="space-y-4 mb-6">
                    <div>
                        <label for="loan-amount" class="block text-sm font-medium">Monto a Solicitar</label>
                        <input type="text" id="loan-amount" class="w-full p-2 border rounded-lg mt-1" inputmode="numeric" required>
                    </div>
                    <div>
                        <label for="loan-reason" class="block text-sm font-medium">Motivo</label>
                        <textarea id="loan-reason" class="w-full p-2 border rounded-lg mt-1" rows="3" required></textarea>
                    </div>
                    <button type="submit" class="w-full bg-yellow-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-yellow-700">Enviar Solicitud</button>
                </form>
                <div>
                    <h3 class="text-lg font-semibold border-t pt-4">Mis Solicitudes</h3>
                    <div id="my-loans-list" class="space-y-2 mt-2 max-h-60 overflow-y-auto">Cargando...</div>
                </div>
            </div>
        `;
    document.getElementById('modal').classList.remove('hidden');
    document.getElementById('close-loan-modal').addEventListener('click', hideModal);

    const amountInput = document.getElementById('loan-amount');
    amountInput.addEventListener('focus', (e) => unformatCurrencyInput(e.target));
    amountInput.addEventListener('blur', (e) => formatCurrencyInput(e.target));

    document.getElementById('loan-request-form').addEventListener('submit', handleLoanRequestSubmit);

    // Cargar historial de préstamos del usuario
    const loansListEl = document.getElementById('my-loans-list');
    // CORRECCIÓN: Se elimina el orderBy para evitar el error de índice.
    const q = query(collection(db, "prestamos"), where("employeeId", "==", currentUser.uid));
    onSnapshot(q, (snapshot) => {
        const prestamos = snapshot.docs.map(d => d.data());

        // CORRECCIÓN: Se ordena manualmente después de recibir los datos.
        prestamos.sort((a, b) => new Date(b.requestDate) - new Date(a.requestDate));

        if (prestamos.length === 0) {
            loansListEl.innerHTML = '<p class="text-center text-gray-500 py-4">No tienes solicitudes de préstamo.</p>';
            return;
        }
        loansListEl.innerHTML = '';
        prestamos.forEach(p => {
            const el = document.createElement('div');
            el.className = 'border p-3 rounded-lg flex justify-between items-center';
            let statusBadge = '';
            switch (p.status) {
                case 'solicitado': statusBadge = `<span class="text-xs font-semibold bg-yellow-200 text-yellow-800 px-2 py-1 rounded-full">Solicitado</span>`; break;
                case 'aprobado': statusBadge = `<span class="text-xs font-semibold bg-blue-200 text-blue-800 px-2 py-1 rounded-full">Aprobado</span>`; break;
                case 'cancelado': statusBadge = `<span class="text-xs font-semibold bg-gray-200 text-gray-800 px-2 py-1 rounded-full">Cancelado</span>`; break;
                case 'denegado': statusBadge = `<span class="text-xs font-semibold bg-red-200 text-red-800 px-2 py-1 rounded-full">Denegado</span>`; break;
            }
            el.innerHTML = `
                    <div>
                        <p class="font-bold">${formatCurrency(p.amount)}</p>
                        <p class="text-xs text-gray-500">${p.requestDate}</p>
                    </div>
                    ${statusBadge}
                `;
            loansListEl.appendChild(el);
        });
    });
}

// +++ NUEVA FUNCIÓN: Maneja el envío de la solicitud de préstamo +++
async function handleLoanRequestSubmit(e) {
    e.preventDefault();
    const amount = unformatCurrency(document.getElementById('loan-amount').value);
    const reason = document.getElementById('loan-reason').value;

    if (amount <= 0) {
        showModalMessage("El monto debe ser mayor a cero.");
        return;
    }

    const newLoan = {
        employeeId: currentUser.uid,
        employeeName: currentUserData.nombre,
        amount: amount,
        reason: reason,
        requestDate: new Date().toISOString().split('T')[0],
        status: 'solicitado' // Estados: solicitado, aprobado, denegado, cancelado
    };

    showModalMessage("Enviando solicitud...", true);
    try {
        await addDoc(collection(db, "prestamos"), newLoan);
        hideModal();
        showModalMessage("¡Solicitud enviada con éxito!", false, 2000);
    } catch (error) {
        console.error("Error al solicitar préstamo:", error);
        showModalMessage("Error al enviar la solicitud.");
    }
}

// +++ NUEVA FUNCIÓN: Muestra el modal para aprobar un préstamo y seleccionar el método de pago +++
function showApproveLoanModal(loan) {
    const modalContentWrapper = document.getElementById('modal-content-wrapper');
    modalContentWrapper.innerHTML = `
            <div class="bg-white rounded-lg p-6 shadow-xl max-w-sm w-full mx-auto text-left">
                <h2 class="text-xl font-semibold mb-4">Aprobar Préstamo</h2>
                <p class="mb-1"><span class="font-semibold">Empleado:</span> ${loan.employeeName}</p>
                <p class="mb-4"><span class="font-semibold">Monto:</span> ${formatCurrency(loan.amount)}</p>
                <form id="approve-loan-form">
                    <div>
                        <label for="loan-payment-method" class="block text-sm font-medium">Fuente del Pago</label>
                        <select id="loan-payment-method" class="w-full p-3 border border-gray-300 rounded-lg mt-1 bg-white" required>
                            <option value="Efectivo">Efectivo</option>
                            <option value="Nequi">Nequi</option>
                            <option value="Davivienda">Davivienda</option>
                        </select>
                    </div>
                    <div class="flex gap-4 justify-end pt-4 mt-4 border-t">
                        <button type="button" id="cancel-approve-btn" class="bg-gray-200 text-gray-700 px-4 py-2 rounded-lg font-semibold">Cancelar</button>
                        <button type="submit" class="bg-green-600 text-white px-4 py-2 rounded-lg font-semibold">Confirmar Aprobación</button>
                    </div>
                </form>
            </div>
        `;
    document.getElementById('modal').classList.remove('hidden');
    document.getElementById('cancel-approve-btn').addEventListener('click', hideModal);
    document.getElementById('approve-loan-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const paymentMethod = document.getElementById('loan-payment-method').value;
        handleApproveLoan(loan, paymentMethod);
    });
}

// +++ NUEVA FUNCIÓN: Aprueba el préstamo y lo registra como gasto +++
/**
* Aprueba el préstamo, lo registra como gasto Y lo añade al historial de pagos del empleado.
* @param {object} loan - El objeto del préstamo.
* @param {string} paymentMethod - El método de pago seleccionado.
*/
/**
 * Aprueba el préstamo, lo registra como gasto Y lo añade al historial de pagos del empleado.
 * Utiliza el mensaje temporal para no cerrar el modal de RRHH.
 */
/**
 * Aprueba un préstamo y usa el sistema de notificaciones temporales.
 */
async function handleApproveLoan(loan, paymentMethod) {
    showModalMessage("Procesando aprobación...", true);
    try {
        const approvalDate = new Date();
        const dateString = approvalDate.toISOString().split('T')[0];

        const nuevoGasto = {
            fecha: dateString,
            proveedorId: loan.employeeId,
            proveedorNombre: `Préstamo Aprobado: ${loan.employeeName}`,
            numeroFactura: `Préstamo RRHH`,
            valorTotal: loan.amount,
            fuentePago: paymentMethod,
            registradoPor: currentUser.uid,
            timestamp: approvalDate,
            isLoanAdvance: true
        };
        await addDoc(collection(db, "gastos"), nuevoGasto);

        const statsRef = doc(db, "estadisticas", "globales");
        await actualizarSaldoPorGasto(nuevoGasto.fuentePago, nuevoGasto.valorTotal);

        const nuevoPago = {
            motivo: `Préstamo: ${loan.reason.substring(0, 30)}`,
            valor: loan.amount,
            fecha: dateString,
            fuentePago: paymentMethod,
            timestamp: approvalDate.toISOString()
        };
        await updateDoc(doc(db, "users", loan.employeeId), {
            pagos: arrayUnion(nuevoPago)
        });

        await updateDoc(doc(db, "prestamos", loan.id), {
            status: 'aprobado',
            paymentMethod: paymentMethod,
            aprobadoBy: currentUser.uid,
            aprobadoDate: dateString
        });

        hideModal(); // Cierra el modal de "cargando"
        showTemporaryMessage("Préstamo aprobado y registrado.", 'success'); // Muestra notificación

    } catch (error) {
        console.error("Error al aprobar préstamo:", error);
        hideModal();
        showModalMessage("Error al procesar la aprobación.");
    }
}


// +++ FUNCIÓN MODIFICADA: Maneja las acciones del admin sobre los préstamos +++
async function handleLoanAction(loanId, action) {
    // La aprobación ahora tiene su propio flujo, esta función maneja el resto.
    if (action === 'aprobado') return;

    showModalMessage("Actualizando préstamo...", true);
    try {
        if (action === 'denegado') {
            await deleteDoc(doc(db, "prestamos", loanId));
            showModalMessage("Préstamo denegado y eliminado.", false, 2000);
        } else { // 'cancelado'
            const updateData = {
                status: action,
                [`${action}By`]: currentUser.uid,
                [`${action}Date`]: new Date().toISOString().split('T')[0]
            };
            await updateDoc(doc(db, "prestamos", loanId), updateData);
            showModalMessage(`Préstamo marcado como ${action}.`, false, 2000);
        }
    } catch (error) {
        console.error(`Error al ${action} el préstamo:`, error);
        showModalMessage("Error al actualizar el estado del préstamo.");
    }
}

/**
 * Carga todas las solicitudes de préstamo pendientes desde Firestore.
 * Actualiza la notificación (badge) en el botón del encabezado.
 * Solo se ejecuta para administradores.
 */
function loadAllLoanRequests() {
    const q = query(collection(db, "prestamos"), where("status", "==", "solicitado"));
    return onSnapshot(q, (snapshot) => {
        allPendingLoans = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        const badge = document.getElementById('header-loan-badge');
        if (badge) {
            if (allPendingLoans.length > 0) {
                badge.textContent = allPendingLoans.length;
                badge.classList.remove('hidden');
            } else {
                badge.classList.add('hidden');
            }
        }
    });
}

/**
 * Muestra el modal con la lista de todos los préstamos pendientes.
 * @param {Array} requests - La lista de solicitudes de préstamo.
 */
function showAllLoansModal(requests) {
    let requestsHTML = '';
    if (requests.length === 0) {
        requestsHTML = '<p class="text-center text-gray-500 py-4">No hay solicitudes de préstamo pendientes.</p>';
    } else {
        requests.sort((a, b) => new Date(b.requestDate) - new Date(a.requestDate));
        requestsHTML = requests.map(p => {
            // Buscamos al empleado en nuestra lista global para obtener su teléfono
            const empleado = allUsers.find(u => u.id === p.employeeId);
            const telefono = empleado ? empleado.telefono : 'No encontrado';

            return `
            <div class="border p-3 rounded-lg text-left">
                <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center">
                    <div>
                        <p class="font-bold text-gray-800">${p.employeeName}</p>
                        <p class="text-sm text-gray-500">${telefono}</p> 
                        <p class="font-bold text-lg mt-1">${formatCurrency(p.amount)}</p>
                        <p class="text-sm text-gray-600">${p.reason}</p>
                        <p class="text-xs text-gray-400">Solicitado el: ${p.requestDate}</p>
                    </div>
                    <div class="flex items-center gap-2 mt-2 sm:mt-0">
                        <button data-loan-json='${JSON.stringify(p)}' class="approve-loan-btn bg-green-500 text-white text-xs px-3 py-1 rounded-full hover:bg-green-700">Aprobar</button>
                        <button data-loan-id="${p.id}" data-action="denegado" class="loan-action-btn bg-red-500 text-white text-xs px-3 py-1 rounded-full hover:bg-red-600">Denegar</button>
                    </div>
                </div>
            </div>`;
        }).join('');
    }

    const modalContentWrapper = document.getElementById('modal-content-wrapper');
    modalContentWrapper.innerHTML = `
        <div class="bg-white rounded-lg shadow-xl w-11/12 md:w-4/5 lg:w-3/4 mx-auto flex flex-col" style="max-height: 85vh;">
            <div class="flex justify-between items-center p-4 border-b">
                <h2 class="text-xl font-semibold">Solicitudes de Préstamo Pendientes</h2>
                <button id="close-all-loans-modal" class="text-gray-500 hover:text-gray-800 text-3xl">&times;</button>
            </div>
            <div class="p-4 space-y-3 overflow-y-auto">
                ${requestsHTML}
            </div>
        </div>
    `;
    document.getElementById('modal').classList.remove('hidden');
    document.getElementById('close-all-loans-modal').addEventListener('click', hideModal);

    modalContentWrapper.querySelectorAll('.approve-loan-btn').forEach(btn => {
        btn.addEventListener('click', (e) => showApproveLoanModal(JSON.parse(e.currentTarget.dataset.loanJson)));
    });
    modalContentWrapper.querySelectorAll('.loan-action-btn').forEach(btn => {
        btn.addEventListener('click', (e) => handleLoanAction(e.currentTarget.dataset.loanId, e.currentTarget.dataset.action));
    });
}

// --- Lógica para Retenciones ---

const retencionModal = document.getElementById('retencion-modal');
const retencionForm = document.getElementById('retencion-form');
const retencionValorInput = document.getElementById('retencion-valor');

// Formato de moneda para el input
retencionValorInput.addEventListener('focus', (e) => unformatCurrencyInput(e.target));
retencionValorInput.addEventListener('blur', (e) => formatCurrencyInput(e.target));

document.getElementById('close-retencion-modal').addEventListener('click', () => {
    retencionModal.classList.add('hidden');
});

function showRetencionModal(remision) {
    document.getElementById('retencion-remision-num').textContent = remision.numeroRemision;
    document.getElementById('retencion-total-actual').textContent = formatCurrency(remision.valorTotal);
    document.getElementById('retencion-remision-id').value = remision.id;

    retencionValorInput.value = '';
    retencionModal.classList.remove('hidden');
}

retencionForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const remisionId = document.getElementById('retencion-remision-id').value;
    // Ya no buscamos 'retencion-tipo' porque lo borramos del HTML
    const valor = unformatCurrency(retencionValorInput.value);

    if (valor <= 0) {
        showModalMessage("El valor debe ser mayor a cero.");
        return;
    }

    retencionModal.classList.add('hidden');
    showModalMessage("Aplicando retención...", true);

    try {
        const applyRetentionFn = httpsCallable(functions, 'applyRetention');
        // Solo enviamos el ID y el monto. El backend pondrá el nombre genérico.
        const result = await applyRetentionFn({
            remisionId: remisionId,
            amount: valor
        });

        if (result.data.success) {
            hideModal();
            showModalMessage("Retención aplicada exitosamente.", false, 2000);
        } else {
            throw new Error(result.data.message);
        }

    } catch (error) {
        console.error("Error al aplicar retención:", error);
        hideModal();
        showModalMessage("Error: " + error.message);
    }
});

// --- Lógica de Saldos Iniciales ---
let globalSaldosBase = { Efectivo: 0, Nequi: 0, Davivienda: 0 };
let saldosYaConfigurados = false; // <--- NUEVA VARIABLE DE CONTROL

// Cargar saldos al iniciar la app
async function loadSaldosBase() {
    try {
        const docRef = doc(db, 'configuracion', 'saldos_globales');
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            globalSaldosBase = docSnap.data();
            saldosYaConfigurados = true; // <--- SI EXISTE EL DOC, MARCAMOS COMO TRUE
        }
    } catch (error) {
        console.error("Error cargando saldos base:", error);
    }
}


function showSaldosInicialesModal() {
    // Poner valores actuales en los inputs
    document.getElementById('saldo-base-efectivo').value = formatCurrency(globalSaldosBase.Efectivo || 0);
    document.getElementById('saldo-base-nequi').value = formatCurrency(globalSaldosBase.Nequi || 0);
    document.getElementById('saldo-base-davivienda').value = formatCurrency(globalSaldosBase.Davivienda || 0);

    document.getElementById('saldos-iniciales-modal').classList.remove('hidden');
}

document.getElementById('close-saldos-modal').addEventListener('click', () => {
    document.getElementById('saldos-iniciales-modal').classList.add('hidden');
});

document.getElementById('saldos-iniciales-form').addEventListener('submit', async (e) => {
    e.preventDefault();

    const nuevosSaldos = {
        Efectivo: unformatCurrency(document.getElementById('saldo-base-efectivo').value),
        Nequi: unformatCurrency(document.getElementById('saldo-base-nequi').value),
        Davivienda: unformatCurrency(document.getElementById('saldo-base-davivienda').value)
    };

    showModalMessage("Guardando saldos...", true);

    try {
        const docRef = doc(db, 'configuracion', 'saldos_globales');
        await setDoc(docRef, nuevosSaldos);

        globalSaldosBase = nuevosSaldos;
        saldosYaConfigurados = true; // <--- Actualizamos la variable global

        // Ocultar modal y mensaje de éxito
        document.getElementById('saldos-iniciales-modal').classList.add('hidden');
        showModalMessage("Saldos actualizados. El botón de configuración ha desaparecido.", false, 3000);

        // --- MAGIA: Eliminar el botón visualmente al instante ---
        const btnBoton = document.getElementById('btn-saldos-iniciales');
        if (btnBoton) {
            btnBoton.remove(); // Adiós botón
        }

        // Actualizamos los números del dashboard para reflejar el cambio inmediatamente
        const monthSelect = document.getElementById('summary-month');
        const yearSelect = document.getElementById('summary-year');
        if (monthSelect && yearSelect) {
            updateDashboard(parseInt(yearSelect.value), parseInt(monthSelect.value));
        }

    } catch (error) {
        console.error(error);
        showModalMessage("Error guardando saldos.");
    }
});

// --- EXPOSICIÓN GLOBAL DE FUNCIONES ---
// Esto permite que el onclick="" del HTML encuentre las funciones JS
window.showSaldosInicialesModal = showSaldosInicialesModal;

// También necesitamos estas dos para que funcionen los inputs del modal (onfocus/onblur)
window.unformatCurrencyInput = unformatCurrencyInput;
window.formatCurrencyInput = formatCurrencyInput;

function showExportPaymentsModal() {
    const modalContentWrapper = document.getElementById('modal-content-wrapper');

    // Fechas por defecto (Primer día del mes actual y día de hoy)
    const date = new Date();
    const firstDay = new Date(date.getFullYear(), date.getMonth(), 1).toISOString().split('T')[0];
    const today = date.toISOString().split('T')[0];

    modalContentWrapper.innerHTML = `
        <div class="bg-white rounded-lg p-6 shadow-xl max-w-sm w-full mx-auto text-left">
            <div class="flex justify-between items-center mb-4">
                <h2 class="text-xl font-semibold">Exportar Pagos</h2>
                <button id="close-export-modal" class="text-gray-500 hover:text-gray-800 text-3xl">&times;</button>
            </div>
            <p class="text-sm text-gray-600 mb-4">Selecciona el rango de fechas para generar el reporte en Excel.</p>
            <form id="export-payments-form" class="space-y-4">
                <div>
                    <label class="block text-sm font-medium text-gray-700">Fecha Inicio</label>
                    <input type="date" id="export-start-date" class="w-full p-2 border rounded-lg mt-1" value="${firstDay}" required>
                </div>
                <div>
                    <label class="block text-sm font-medium text-gray-700">Fecha Fin</label>
                    <input type="date" id="export-end-date" class="w-full p-2 border rounded-lg mt-1" value="${today}" required>
                </div>
                <div class="pt-2">
                    <button type="submit" class="w-full bg-green-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-green-700 flex justify-center items-center gap-2">
                        <span>Descargar Excel</span>
                        <i class="fas fa-file-excel"></i>
                    </button>
                </div>
            </form>
        </div>
    `;

    document.getElementById('modal').classList.remove('hidden');
    document.getElementById('close-export-modal').addEventListener('click', hideModal);

    document.getElementById('export-payments-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const startDate = document.getElementById('export-start-date').value;
        const endDate = document.getElementById('export-end-date').value;

        if (startDate > endDate) {
            showModalMessage("La fecha de inicio no puede ser mayor a la fecha fin.");
            return;
        }

        // Llamamos a la función de descarga con las fechas seleccionadas
        downloadPaymentsExcel(startDate, endDate);
        hideModal();
    });
}

// --- CARGA ESPECIALIZADA PARA FACTURACIÓN ---
function loadRemisionesFacturacion() {
    if (facturacionUnsubscribe) facturacionUnsubscribe();

    // Traemos TODAS las pendientes (sin limit) para que siempre veas tu trabajo pendiente completo
    const q = query(
        collection(db, "remisiones"),
        where("incluyeIVA", "==", true),
        where("facturado", "==", false),
        where("estado", "!=", "Anulada")
    );

    facturacionUnsubscribe = onSnapshot(q, (snapshot) => {
        remisionesPendientesFactura = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderFacturacion();
    });
    return facturacionUnsubscribe;
}

async function loadFacturadasHistorial(isMore = false) {
    if (cargandoMasFacturadas) return;

    const remisionesRef = collection(db, "remisiones");
    let q = query(
        remisionesRef,
        where("incluyeIVA", "==", true),
        where("facturado", "==", true),
        orderBy("numeroRemision", "desc"),
        limit(50)
    );

    if (isMore && lastFacturadaDoc) {
        cargandoMasFacturadas = true;
        q = query(q, startAfter(lastFacturadaDoc));
    } else {
        remisionesFacturadasHistorial = [];
        lastFacturadaDoc = null;
    }

    try {
        const snapshot = await getDocs(q);
        if (snapshot.empty) {
            cargandoMasFacturadas = false;
            return;
        }

        lastFacturadaDoc = snapshot.docs[snapshot.docs.length - 1];
        const nuevas = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        remisionesFacturadasHistorial = [...remisionesFacturadasHistorial, ...nuevas];
        renderFacturacion();
        cargandoMasFacturadas = false;
    } catch (error) {
        console.error("Error cargando historial de facturación:", error);
        cargandoMasFacturadas = false;
    }
}

// --- CARGA ESPECIALIZADA PARA CARTERA (Saldos Pendientes) ---
function loadRemisionesCartera() {
    if (carteraUnsubscribe) carteraUnsubscribe();

    // Incluimos 'Entregado' para no perder de vista las deudas de remisiones ya finalizadas
    const q = query(
        collection(db, "remisiones"),
        where("estado", "in", ["Recibido", "En Proceso", "Procesado", "Entregado"]),
        orderBy("numeroRemision", "desc")
    );

    carteraUnsubscribe = onSnapshot(q, (snapshot) => {
        // Guardamos solo las que realmente tienen saldo > 0
        remisionesCartera = snapshot.docs
            .map(doc => ({ id: doc.id, ...doc.data() }))
            .filter(r => {
                const pagado = (r.payments || []).filter(p => p.status === 'confirmado').reduce((s, p) => s + p.amount, 0);
                return (r.valorTotal - pagado) > 0.01 && r.estado !== 'Anulada';
            });
        renderCartera();
    });
    return carteraUnsubscribe;
}

function showExportRemisionesModal() {
    const modalContentWrapper = document.getElementById('modal-content-wrapper');
    const date = new Date();
    const firstDay = new Date(date.getFullYear(), date.getMonth(), 1).toISOString().split('T')[0];
    const today = date.toISOString().split('T')[0];

    modalContentWrapper.innerHTML = `
        <div class="bg-white rounded-lg p-6 shadow-xl max-w-sm w-full mx-auto text-left">
            <div class="flex justify-between items-center mb-4">
                <h2 class="text-xl font-semibold">Exportar Remisiones</h2>
                <button id="close-export-rem-modal" class="text-gray-500 hover:text-gray-800 text-3xl">&times;</button>
            </div>
            <p class="text-sm text-gray-600 mb-4">Selecciona el rango de fechas para exportar el valor de las remisiones.</p>
            <form id="export-remisiones-form" class="space-y-4">
                <div>
                    <label class="block text-sm font-medium text-gray-700">Fecha Inicio</label>
                    <input type="date" id="export-rem-start" class="w-full p-2 border rounded-lg mt-1" value="${firstDay}" required>
                </div>
                <div>
                    <label class="block text-sm font-medium text-gray-700">Fecha Fin</label>
                    <input type="date" id="export-rem-end" class="w-full p-2 border rounded-lg mt-1" value="${today}" required>
                </div>
                <button type="submit" class="w-full bg-teal-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-teal-700">Descargar Excel</button>
            </form>
        </div>
    `;

    document.getElementById('modal').classList.remove('hidden');
    document.getElementById('close-export-rem-modal').addEventListener('click', hideModal);

    document.getElementById('export-remisiones-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const start = document.getElementById('export-rem-start').value;
        const end = document.getElementById('export-rem-end').value;
        downloadRemisionesExcel(start, end);
        hideModal();
    });
}

function downloadRemisionesExcel(startDateStr, endDateStr) {
    if (typeof XLSX === 'undefined') {
        showModalMessage("Error: La librería de Excel no está cargada.");
        return;
    }

    const start = startDateStr;
    const end = endDateStr;

    // Filtramos las remisiones por fecha y que no estén anuladas
    const remisionesFiltradas = allRemisiones.filter(r =>
        r.fechaRecibido >= start &&
        r.fechaRecibido <= end &&
        r.estado !== 'Anulada'
    );

    if (remisionesFiltradas.length === 0) {
        showModalMessage(`No hay remisiones (no anuladas) entre ${startDateStr} y ${endDateStr}.`);
        return;
    }

    // Mapeamos los datos para el Excel
    const dataParaExcel = remisionesFiltradas.map(r => ({
        "N° Remisión": r.numeroRemision,
        "Fecha": r.fechaRecibido,
        "Cliente": r.clienteNombre,
        "Estado": r.estado,
        "Subtotal": r.subtotal || 0,
        "IVA": r.valorIVA || 0,
        "Total": r.valorTotal || 0,
        "Forma de Pago": r.formaPago,
        "Facturado": r.facturado ? "Sí" : "No"
    }));

    // Ordenar por número de remisión descendente
    dataParaExcel.sort((a, b) => b["N° Remisión"] - a["N° Remisión"]);

    try {
        const worksheet = XLSX.utils.json_to_sheet(dataParaExcel);

        // Ajustar anchos de columna
        worksheet['!cols'] = [
            { wch: 12 }, { wch: 12 }, { wch: 35 }, { wch: 15 },
            { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 10 }
        ];

        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Remisiones");

        const fileName = `Remisiones_Valores_${startDateStr}_a_${endDateStr}.xlsx`;
        XLSX.writeFile(workbook, fileName);

        showModalMessage("Excel de remisiones generado.", false, 2000);
    } catch (error) {
        console.error("Error al exportar remisiones:", error);
        showModalMessage("Error al generar el archivo Excel.");
    }
}

function showExportGastosModal() {
    const modalContentWrapper = document.getElementById('modal-content-wrapper');
    const date = new Date();
    const firstDay = new Date(date.getFullYear(), date.getMonth(), 1).toISOString().split('T')[0];
    const today = date.toISOString().split('T')[0];

    modalContentWrapper.innerHTML = `
        <div class="bg-white rounded-lg p-6 shadow-xl max-w-sm w-full mx-auto text-left">
            <div class="flex justify-between items-center mb-4">
                <h2 class="text-xl font-semibold">Exportar Gastos</h2>
                <button id="close-export-gastos-modal" class="text-gray-500 hover:text-gray-800 text-3xl">&times;</button>
            </div>
            <p class="text-sm text-gray-600 mb-4">Selecciona el rango de fechas para exportar el detalle de gastos y sueldos.</p>
            <form id="export-gastos-form" class="space-y-4">
                <div>
                    <label class="block text-sm font-medium text-gray-700">Fecha Inicio</label>
                    <input type="date" id="export-gas-start" class="w-full p-2 border rounded-lg mt-1" value="${firstDay}" required>
                </div>
                <div>
                    <label class="block text-sm font-medium text-gray-700">Fecha Fin</label>
                    <input type="date" id="export-gas-end" class="w-full p-2 border rounded-lg mt-1" value="${today}" required>
                </div>
                <button type="submit" class="w-full bg-orange-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-orange-700">Descargar Excel Gastos</button>
            </form>
        </div>
    `;

    document.getElementById('modal').classList.remove('hidden');
    document.getElementById('close-export-gastos-modal').addEventListener('click', hideModal);

    document.getElementById('export-gastos-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const start = document.getElementById('export-gas-start').value;
        const end = document.getElementById('export-gas-end').value;
        downloadGastosExcel(start, end);
        hideModal();
    });
}

function downloadGastosExcel(startDateStr, endDateStr) {
    if (typeof XLSX === 'undefined') {
        showModalMessage("Error: La librería de Excel no está cargada.");
        return;
    }

    // Filtramos del array global de gastos (allGastos)
    const gastosFiltrados = allGastos.filter(g =>
        g.fecha >= startDateStr &&
        g.fecha <= endDateStr
    );

    if (gastosFiltrados.length === 0) {
        showModalMessage(`No se encontraron gastos entre ${startDateStr} y ${endDateStr}.`);
        return;
    }

    // Mapeamos los campos para el archivo Excel
    const dataParaExcel = gastosFiltrados.map(g => ({
        "Fecha": g.fecha,
        "Descripción / Concepto": g.descripcion,
        "Categoría": g.categoria || "General",
        "Fuente de Pago": g.fuentePago,
        "Valor Total": g.valorTotal || 0,
        "Registrado por": g.createdBy || "Sistema"
    }));

    // Ordenamos por fecha (más reciente primero)
    dataParaExcel.sort((a, b) => b.Fecha.localeCompare(a.Fecha));

    try {
        const worksheet = XLSX.utils.json_to_sheet(dataParaExcel);

        // Ajustar anchos de columna para que se vea profesional
        worksheet['!cols'] = [
            { wch: 12 }, { wch: 40 }, { wch: 20 }, { wch: 15 }, { wch: 15 }, { wch: 20 }
        ];

        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Gastos");

        const fileName = `Reporte_Gastos_${startDateStr}_a_${endDateStr}.xlsx`;
        XLSX.writeFile(workbook, fileName);

        showModalMessage("Excel de gastos generado correctamente.", false, 2000);
    } catch (error) {
        console.error("Error al exportar gastos:", error);
        showModalMessage("Hubo un error al generar el archivo de Gastos.");
    }
}

async function actualizarSaldoPorPago(metodo, monto) {
    if (!metodo || metodo === 'Pendiente') return;
    const statsRef = doc(db, "estadisticas", "globales");
    await updateDoc(statsRef, { [`saldo${metodo}`]: increment(monto) });
}

async function actualizarSaldoPorGasto(metodo, monto) {
    if (!metodo) return;
    const statsRef = doc(db, "estadisticas", "globales");
    await updateDoc(statsRef, { [`saldo${metodo}`]: increment(-monto) });
}

function listenGlobalSaldos() {
    const statsRef = doc(db, "estadisticas", "globales");

    onSnapshot(statsRef, (docSnap) => {
        if (docSnap.exists()) {
            const d = docSnap.data();

            // 1. GUARDAMOS en la variable global (esto es lo más importante)
            globalesSaldos.Efectivo = d.saldoEfectivo || 0;
            globalesSaldos.Nequi = d.saldoNequi || 0;
            globalesSaldos.Davivienda = d.saldoDavivienda || 0;

            // 2. ACTUALIZAMOS la UI solo si el dashboard está abierto en este segundo
            const efEl = document.getElementById('summary-efectivo');
            if (efEl) {
                efEl.textContent = formatCurrency(globalesSaldos.Efectivo);
                document.getElementById('summary-nequi').textContent = formatCurrency(globalesSaldos.Nequi);
                document.getElementById('summary-davivienda').textContent = formatCurrency(globalesSaldos.Davivienda);
            }
        }
    });
}
async function migrarSaldosAGlobales() {
    showModalMessage("Iniciando migración de saldos históricos...", true);

    // 1. Saldo inicial configurado por ti
    let saldos = {
        saldoEfectivo: globalSaldosBase.Efectivo || 0,
        saldoNequi: globalSaldosBase.Nequi || 0,
        saldoDavivienda: globalSaldosBase.Davivienda || 0
    };

    try {
        // 2. Sumar todos los pagos confirmados de la historia
        const snapRem = await getDocs(collection(db, "remisiones"));
        snapRem.forEach(doc => {
            const r = doc.data();
            if (r.estado !== 'Anulada' && r.payments) {
                r.payments.forEach(p => {
                    if (p.status === 'confirmado') {
                        if (p.method === 'Efectivo') saldos.saldoEfectivo += p.amount;
                        if (p.method === 'Nequi') saldos.saldoNequi += p.amount;
                        if (p.method === 'Davivienda') saldos.saldoDavivienda += p.amount;
                    }
                });
            }
        });

        // 3. Restar todos los gastos de la historia
        const snapGas = await getDocs(collection(db, "gastos"));
        snapGas.forEach(doc => {
            const g = doc.data();
            if (g.fuentePago === 'Efectivo') saldos.saldoEfectivo -= g.valorTotal;
            if (g.fuentePago === 'Nequi') saldos.saldoNequi -= g.valorTotal;
            if (g.fuentePago === 'Davivienda') saldos.saldoDavivienda -= g.valorTotal;
        });

        // 4. Guardar el resultado en el nuevo documento "Bolsa de Totales"
        await setDoc(doc(db, "estadisticas", "globales"), saldos);

        hideModal();
        showModalMessage("¡Migración completada! Saldos sincronizados.");
        console.log("Saldos migrados:", saldos);
    } catch (error) {
        console.error("Error en migración:", error);
        showModalMessage("Error en la migración. Revisa la consola.");
    }
}

let activeChatPhone = null;

// FUNCIÓN: Configura los eventos del CRM
function setupWhatsAppEvents() {
    const sendBtn = document.getElementById('wa-send-btn');
    const input = document.getElementById('wa-reply-input');

    sendBtn?.addEventListener('click', sendWAReply);
    input?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendWAReply();
    });
}

// FUNCIÓN: Escucha mensajes en tiempo real
function listenWhatsAppMessages() {
    const q = query(collection(db, "mensajes_whatsapp"), orderBy("fecha", "asc"));
    return onSnapshot(q, (snapshot) => {
        const allMsg = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderCRMContactList(allMsg);
        if (activeChatPhone) renderCRMThread(allMsg.filter(m => m.telefono === activeChatPhone));
    });
}

// FUNCIÓN: Lista de contactos
function renderCRMContactList(messages) {
    const listEl = document.getElementById('wa-contacts-list');
    if (!listEl) return;

    const contactMap = {};
    messages.forEach(m => {
        // Aseguramos que el teléfono esté normalizado también al agrupar
        const phone = m.telefono.length === 12 && m.telefono.startsWith('57')
            ? m.telefono.substring(2)
            : m.telefono;
        contactMap[phone] = m;
    });

    const contacts = Object.values(contactMap).sort((a, b) => b.fecha - a.fecha);

    listEl.innerHTML = '';
    contacts.forEach(contact => {
        const phone = contact.telefono.length === 12 && contact.telefono.startsWith('57')
            ? contact.telefono.substring(2)
            : contact.telefono;

        const isSelected = activeChatPhone === phone;

        // BUSCAR NOMBRE DEL CLIENTE:
        // Buscamos en el array global 'allClientes' que ya tienes cargado
        const clienteEncontrado = allClientes.find(c =>
            c.telefono1 === phone || c.telefono2 === phone
        );
        const nombreMostrar = clienteEncontrado ? clienteEncontrado.nombre : phone;

        const div = document.createElement('div');
        div.className = `p-4 cursor-pointer hover:bg-white border-l-4 transition-all ${isSelected ? 'bg-white border-green-500 shadow-inner' : 'border-transparent'}`;

        div.innerHTML = `
            <div class="flex items-center gap-3">
                <div class="w-12 h-12 ${clienteEncontrado ? 'bg-green-600' : 'bg-gray-400'} rounded-full flex items-center justify-center text-white font-bold text-xl">
                    ${nombreMostrar.charAt(0).toUpperCase()}
                </div>
                <div class="overflow-hidden flex-grow">
                    <div class="flex justify-between">
                        <p class="font-bold text-sm text-gray-800">${nombreMostrar}</p>
                        <p class="text-[10px] text-gray-400">${contact.fecha?.toDate ? contact.fecha.toDate().toLocaleDateString() : ''}</p>
                    </div>
                    <p class="text-xs text-gray-500 truncate w-48">${contact.contenido || 'Archivo'}</p>
                </div>
            </div>
        `;
        div.onclick = () => selectContact(phone);
        listEl.appendChild(div);
    });
}

let currentChatUnsubscribe = null;

function selectContact(phone) {
    activeChatPhone = phone;

    toggleMobileChatView(true);

    // UI: Mostrar el área de chat y ocultar el mensaje de bienvenida

    document.getElementById('wa-no-chat-selected').classList.add('hidden');
    document.getElementById('wa-chat-active').classList.remove('hidden');
    document.getElementById('wa-chat-active').classList.add('flex');

    const cliente = allClientes.find(c => c.telefono1 === phone || c.telefono2 === phone);
    document.getElementById('active-chat-name').textContent = cliente ? cliente.nombre : phone;

    // 1. Limpiar el listener anterior para evitar fugas de memoria
    if (currentChatUnsubscribe) currentChatUnsubscribe();

    const q = query(
        collection(db, "chats", phone, "mensajes"),
        orderBy("fecha", "asc"),
        limit(100)
    );

    currentChatUnsubscribe = onSnapshot(q, (snapshot) => {
        const messages = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        renderCRMThread(messages);
        markAllWAAsRead(phone, messages);

        // --- AQUÍ LLAMAMOS A LA NUEVA FUNCIÓN ---
        updateClientContext(phone, messages);

        updateDoc(doc(db, "chats", phone), { noLeidos: 0 }).catch(e => console.error(e));
    });
}

// FUNCIÓN: Hilo de mensajes
function renderCRMThread(messages) {
    const threadEl = document.getElementById('whatsapp-messages-list');
    if (!threadEl) return;

    threadEl.innerHTML = '';
    messages.forEach(msg => {
        const isOut = msg.tipo === 'saliente';
        const div = document.createElement('div');

        // Estilo de burbuja
        div.className = `max-w-[80%] p-2 rounded-lg text-sm mb-2 shadow-sm ${isOut ? 'bg-[#dcf8c6] self-end' : 'bg-white self-start'}`;

        let contentHTML = `<p>${msg.contenido || ''}</p>`;

        // Manejo de Multimedia Profesional
        if (msg.mimeType === "image" && msg.mediaUrl) {
            contentHTML = `
            <div class="relative group">
                <img src="${msg.mediaUrl}" 
                    class="rounded-lg max-w-full h-auto cursor-zoom-in shadow-sm border border-gray-100" 
                    loading="lazy"
                    onclick="window.open('${msg.mediaUrl}', '_blank')">
            </div>`;
        } else if (msg.mimeType === "audio" && msg.mediaUrl) {
            contentHTML = `<audio controls class="w-48 h-8"><source src="${msg.mediaUrl}"></audio>`;
        }

        // Icono de confirmación de lectura
        // Lógica de iconos de estado
        let statusIcon = '';
        if (isOut) {
            if (msg.status === 'sent') {
                statusIcon = '<i class="fa-solid fa-check text-gray-400"></i>'; // Un check gris
            } else if (msg.status === 'delivered') {
                statusIcon = '<i class="fa-solid fa-check-double text-gray-400"></i>'; // Doble check gris
            } else if (msg.status === 'read') {
                statusIcon = '<i class="fa-solid fa-check-double text-blue-500"></i>'; // Doble check azul
            } else {
                statusIcon = '<i class="fa-solid fa-clock text-gray-300"></i>'; // Reloj (pendiente)
            }
        }
        div.innerHTML = `
            ${contentHTML}
            <div class="flex items-center justify-end gap-1 mt-1">
                <span class="text-[9px] text-gray-400">${msg.fecha?.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                ${isOut ? statusIcon : ''}
            </div>
        `;
        threadEl.appendChild(div);
    });
    threadEl.scrollTop = threadEl.scrollHeight;
}



// FUNCIÓN: Marcar como leído
async function markAllWAAsRead(phone, messages) {
    // Filtramos solo mensajes entrantes que aún dicen "leido: false"
    const unread = messages.filter(m => m.tipo === 'entrante' && m.leido === false);

    if (unread.length === 0) return; // Si no hay nada nuevo, no hacemos nada

    // Usamos un bucle para actualizar cada mensaje
    for (const msg of unread) {
        try {
            // RUTA CORRECTA: chats -> numero -> mensajes -> id_del_mensaje
            const msgRef = doc(db, "chats", phone, "mensajes", msg.id);
            await updateDoc(msgRef, { leido: true });
        } catch (e) {
            console.error("No se pudo marcar el mensaje como leído:", e);
        }
    }
}

// FUNCIÓN: Enviar respuesta
async function sendWAReply() {
    const input = document.getElementById('wa-reply-input');
    const text = input.value.trim();
    if (!text || !activeChatPhone) return;

    try {
        const sendMsgFn = httpsCallable(functions, 'sendWhatsAppMessage');
        // Solo llamamos a la función. 
        // NO guardamos aquí, la función se encargará de hacerlo.
        await sendMsgFn({ telefono: activeChatPhone, mensaje: text });

        input.value = ''; // Limpiamos el input
    } catch (error) {
        console.error("Error al responder:", error);
        showTemporaryMessage("Error al enviar mensaje", "error");
    }
}

/**
 * Escucha la lista de chats en tiempo real y actualiza la UI del CRM.
 * Incluye el contador global de mensajes no leídos para el menú principal.
 */
function listenChatList() {
    const listEl = document.getElementById('wa-contacts-list');
    const globalBadge = document.getElementById('global-unread-badge');

    // Escuchamos la colección de chats ordenados por la fecha del último mensaje
    const q = query(collection(db, "chats"), orderBy("fechaUltimo", "desc"));

    return onSnapshot(q, (snapshot) => {
        if (!listEl) return;
        listEl.innerHTML = '';

        if (snapshot.empty) {
            listEl.innerHTML = '<p class="text-center text-gray-400 text-xs py-10">No hay conversaciones aún.</p>';
            if (globalBadge) globalBadge.classList.add('hidden');
            return;
        }

        let totalUnreadGlobal = 0; // Acumulador para el badge de la pestaña principal

        snapshot.forEach(docChat => {
            const chat = docChat.data();
            const phone = docChat.id; // El ID del documento es el número de teléfono

            // Sumamos al contador global
            totalUnreadGlobal += (chat.noLeidos || 0);

            // Buscamos si el teléfono pertenece a un cliente registrado
            const cliente = allClientes.find(c => c.telefono1 === phone || c.telefono2 === phone);
            const nombreMostrar = cliente ? cliente.nombre : phone;
            const isSelected = activeChatPhone === phone;

            const div = document.createElement('div');
            // Diseño de la tarjeta de contacto
            div.className = `p-4 cursor-pointer hover:bg-gray-50 border-l-4 transition-all ${
                isSelected ? 'bg-white border-indigo-500 shadow-sm' : 'border-transparent bg-gray-50/30'
            }`;

            div.innerHTML = `
                <div class="flex items-center gap-3">
                    <div class="w-12 h-12 ${cliente ? 'bg-green-600' : 'bg-gray-400'} rounded-full flex items-center justify-center text-white font-bold shrink-0 shadow-sm">
                        ${nombreMostrar.charAt(0).toUpperCase()}
                    </div>
                    
                    <div class="overflow-hidden flex-grow">
                        <div class="flex justify-between items-start">
                            <p class="font-bold text-sm text-gray-800 truncate pr-2">${nombreMostrar}</p>
                            <span class="text-[9px] text-gray-400 whitespace-nowrap">
                                ${chat.fechaUltimo ? chat.fechaUltimo.toDate().toLocaleDateString([], {day:'2-digit', month:'2-digit'}) : ''}
                            </span>
                        </div>
                        <div class="flex justify-between items-center mt-1">
                            <p class="text-xs text-gray-500 truncate w-40 italic">
                                ${chat.ultimoMensaje || 'Archivo multimedia'}
                            </p>
                            ${chat.noLeidos > 0 ? 
                                `<span class="bg-green-500 text-white text-[10px] font-black px-2 py-0.5 rounded-full shadow-sm animate-pulse">
                                    ${chat.noLeidos}
                                </span>` : ''
                            }
                        </div>
                    </div>
                </div>
            `;

            // Al hacer clic, abrimos la conversación
            div.onclick = () => selectContact(phone);
            listEl.appendChild(div);
        });

        // --- ACTUALIZACIÓN DE LA BOLITA ROJA GLOBAL ---
        if (globalBadge) {
            if (totalUnreadGlobal > 0) {
                globalBadge.textContent = totalUnreadGlobal > 99 ? '99+' : totalUnreadGlobal;
                globalBadge.classList.remove('hidden');
                // Opcional: Cambiar el título de la pestaña del navegador
                document.title = `(${totalUnreadGlobal}) PrismaColor - Gestión`;
            } else {
                globalBadge.classList.add('hidden');
                document.title = `PrismaColor - Sistema de Gestión`;
            }
        }
    }, (error) => {
        console.error("Error escuchando lista de chats:", error);
    });
}

// 1. FUNCIÓN: Actualizar el Sidebar y el Cronómetro
async function updateClientContext(phone, messages) {
    const cliente = allClientes.find(c => c.telefono1 === phone || c.telefono2 === phone);

    // Elementos de la UI
    const timerEl = document.getElementById('wa-window-timer');
    const sideCompras = document.getElementById('wa-side-total-compras');
    const sideDeuda = document.getElementById('wa-side-total-deuda');
    const sideList = document.getElementById('wa-side-remisiones-list');
    const labelCompras = document.querySelector('#wa-client-sidebar p.text-indigo-500'); // El label pequeño

    // 1. Timer WhatsApp (Sin cambios)
    const lastIncoming = messages.filter(m => m.tipo === 'entrante').pop();
    if (lastIncoming && lastIncoming.fecha) {
        const lastDate = lastIncoming.fecha.toDate();
        const diffMs = 86400000 - (new Date() - lastDate);
        if (diffMs > 0) {
            const h = Math.floor(diffMs / 3600000);
            const m = Math.floor((diffMs % 3600000) / 60000);
            timerEl.innerHTML = `<span class="text-emerald-600 font-bold"><i class="fa-solid fa-clock"></i> Ventana: ${h}h ${m}m</span>`;
        } else {
            timerEl.innerHTML = `<span class="text-rose-600 font-bold"><i class="fa-solid fa-circle-exclamation"></i> Ventana cerrada</span>`;
        }
    }

    if (!cliente) {
        sideList.innerHTML = '<p class="text-center text-[10px] text-gray-400 py-4 italic">Cliente no identificado</p>';
        return;
    }

    try {
        // Ejecutamos la consulta optimizada
        const resumen = await getResumenFinancieroOptimizado(cliente.id);

        // Actualizamos la UI
        if (labelCompras) labelCompras.textContent = "Compras (Mes Actual)"; // Cambiamos el texto para claridad
        sideCompras.textContent = formatCurrency(resumen.comprasMes);
        sideDeuda.textContent = formatCurrency(resumen.totalDeuda);

        // Pintar lista de deudas
        let remisionesHTML = '';
        resumen.listaPendientes.sort((a, b) => b.numeroRemision - a.numeroRemision).forEach(r => {
            remisionesHTML += `
                <div class="bg-white border border-gray-100 p-3 rounded-xl shadow-sm hover:border-emerald-500 cursor-pointer transition-all group" 
                     onclick="prepararAbonoDesdeCRM('${r.id}')">
                    <div class="flex justify-between items-center">
                        <span class="font-black text-gray-700 text-[11px]">#${r.numeroRemision}</span>
                        <span class="text-rose-600 font-black text-[11px]">${formatCurrency(r.saldoCalculado)}</span>
                    </div>
                    <p class="text-[9px] text-gray-400 font-medium mt-1">${r.fechaRecibido}</p>
                </div>`;
        });

        sideList.innerHTML = remisionesHTML || '<div class="text-center py-4 text-gray-400 text-[10px] uppercase font-bold">Sin deudas</div>';

        // Listeners de botones de acción
        document.getElementById('wa-side-report-payment').onclick = () => {
            if (resumen.listaPendientes.length === 0) showTemporaryMessage("No hay deudas activas");
            else if (resumen.listaPendientes.length === 1) prepararAbonoDesdeCRM(resumen.listaPendientes[0].id);
            else showRemisionSelectorModal(resumen.listaPendientes, cliente.nombre);
        };

        document.getElementById('wa-side-send-statement').onclick = () => sendAccountStatement(phone);

    } catch (error) {
        console.error("Error al actualizar contexto:", error);
    }
}

function showRemisionSelectorModal(pendientes, clienteNombre) {
    const modalContentWrapper = document.getElementById('modal-content-wrapper');

    const listaHTML = pendientes.map(r => `
        <div class="flex justify-between items-center p-4 border rounded-xl hover:bg-green-50 hover:border-green-300 cursor-pointer transition shadow-sm group"
            onclick="prepararAbonoDesdeCRM('${r.id}')">
            <div>
                <p class="font-black text-gray-800">Remisión N° ${r.numeroRemision}</p>
                <p class="text-xs text-gray-500">Fecha: ${r.fechaRecibido}</p>
            </div>
            <div class="text-right">
                <p class="text-sm text-gray-400">Saldo pendiente:</p>
                <p class="font-bold text-red-600 text-lg">${formatCurrency(r.saldoCalculado)}</p>
                <span class="text-[10px] text-green-600 font-bold uppercase opacity-0 group-hover:opacity-100">Seleccionar para pago</span>
            </div>
        </div>
    `).join('');

    modalContentWrapper.innerHTML = `
        <div class="bg-white rounded-2xl p-6 shadow-2xl max-w-md w-full mx-auto">
            <div class="flex justify-between items-center mb-6">
                <div>
                    <h2 class="text-xl font-black text-gray-800">Seleccionar Remisión</h2>
                    <p class="text-sm text-gray-500">${clienteNombre}</p>
                </div>
                <button id="close-selector-modal" class="text-gray-400 hover:text-gray-800 text-3xl">&times;</button>
            </div>
            
            <div class="space-y-3 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                ${listaHTML}
            </div>
            
            <p class="text-center text-[10px] text-gray-400 mt-6 uppercase tracking-widest">Se muestran solo remisiones con saldo pendiente</p>
        </div>
    `;

    document.getElementById('modal').classList.remove('hidden');
    document.getElementById('close-selector-modal').onclick = hideModal;
}

window.showPaymentModal = showPaymentModal;
window.showRemisionSelectorModal = showRemisionSelectorModal;
window.hideModal = hideModal;
window.prepararAbonoDesdeCRM = prepararAbonoDesdeCRM; // Nueva función auxiliar

// Función auxiliar para abrir el pago buscando la remisión por ID
function prepararAbonoDesdeCRM(remisionId) {
    const remision = allRemisiones.find(r => r.id === remisionId);
    if (remision) {
        hideModal(); // Cerramos el selector si estaba abierto
        // Pequeño delay para dejar que el DOM respire entre modales
        setTimeout(() => {
            showPaymentModal(remision);
        }, 100);
    } else {
        showTemporaryMessage("No se encontró la información de la remisión", "error");
    }
}

// Función para buscar deudas reales en la DB, no solo en la memoria local
async function getDeudasActualizadas(clienteId) {
    const remisionesRef = collection(db, "remisiones");
    // Buscamos todas las remisiones de este cliente que no estén anuladas
    const q = query(
        remisionesRef,
        where("idCliente", "==", clienteId),
        where("estado", "!=", "Anulada")
    );

    const snapshot = await getDocs(q);
    const todas = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // Filtramos las que realmente tienen saldo pendiente > 100 pesos
    return todas.filter(r => {
        const pagado = (r.payments || [])
            .filter(p => p.status === 'confirmado')
            .reduce((acc, p) => acc + p.amount, 0);
        const saldo = r.valorTotal - pagado;
        if (saldo > 100) {
            r.saldoCalculado = saldo; // Adjuntamos el saldo para la UI
            return true;
        }
        return false;
    });
}

async function sendAccountStatement(phone) {
    const cliente = allClientes.find(c => c.telefono1 === phone || c.telefono2 === phone);
    if (!cliente) return showTemporaryMessage("Cliente no encontrado", "error");

    showModalMessage("Generando estado de cuenta...", true);

    try {
        // 1. Obtenemos TODAS las remisiones del cliente (no solo las de la memoria local)
        const remisionesRef = collection(db, "remisiones");
        const q = query(remisionesRef, where("idCliente", "==", cliente.id), where("estado", "!=", "Anulada"));
        const snap = await getDocs(q);

        let totalDeuda = 0;
        let detalleMensaje = "";
        let tienePendientes = false;

        const docs = snap.docs.map(d => d.data()).sort((a, b) => new Date(a.fechaRecibido) - new Date(b.fechaRecibido));

        docs.forEach(r => {
            const pagado = (r.payments || []).filter(p => p.status === 'confirmado').reduce((acc, p) => acc + p.amount, 0);
            const saldo = r.valorTotal - pagado;

            if (saldo > 100) {
                tienePendientes = true;
                totalDeuda += saldo;
                detalleMensaje += `*• Remisión #${r.numeroRemision}* (${r.fechaRecibido})\n   Saldo: _${formatCurrency(saldo)}_\n`;
            }
        });

        // 2. Construcción del Mensaje Profesional
        const fechaHoy = new Date().toLocaleDateString();
        let mensajeFinal = `*ESTADO DE CUENTA - PRISMACALOR SAS*\n`;
        mensajeFinal += `*Cliente:* ${cliente.nombre}\n`;
        mensajeFinal += `*Fecha de corte:* ${fechaHoy}\n`;
        mensajeFinal += `------------------------------------------\n\n`;

        if (tienePendientes) {
            mensajeFinal += `Hola, adjuntamos el detalle de tus cuentas pendientes:\n\n`;
            mensajeFinal += detalleMensaje;
            mensajeFinal += `\n*TOTAL PENDIENTE: ${formatCurrency(totalDeuda)}*\n\n`;
            mensajeFinal += `------------------------------------------\n`;
            mensajeFinal += `*Medios de Pago:*\n`;
            mensajeFinal += `• Llave: @9010430572\n`; // Cambia por tus datos reales
            mensajeFinal += `• Davivienda: Corriente #4776 6999 5664\n\n`;
            mensajeFinal += `• Nequi: 313 252 2810\n`; // Cambia por tus datos reales
            mensajeFinal += `Por favor envíanos el comprobante por este medio. ¡Gracias!`;
        } else {
            mensajeFinal += `🎉 *¡Felicidades!* No tienes cuentas pendientes a la fecha.\n\nGracias por ser un cliente.`;
        }

        // 3. Envío Real por WhatsApp usando tu Cloud Function
        const sendMsgFn = httpsCallable(functions, 'sendWhatsAppMessage');
        await sendMsgFn({ telefono: phone, mensaje: mensajeFinal });

        hideModal();
        showTemporaryMessage("Estado de cuenta enviado con éxito", "success");

    } catch (error) {
        console.error("Error al enviar estado de cuenta:", error);
        hideModal();
        showModalMessage("Error al enviar el estado de cuenta.");
    }
}

// Obtiene el resumen financiero optimizado (Mes actual y deudas recientes)
async function getResumenFinancieroOptimizado(clienteId) {
    const remisionesRef = collection(db, "remisiones");

    // Calculamos el primer día del mes actual para las compras
    const ahora = new Date();
    const primerDiaMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1).toISOString().split('T')[0];

    // Calculamos una fecha de "corte" para deudas (ej. hace 4 meses) 
    // para no leer toda la historia, pero no perder deudas viejas.
    const fechaCorteDeudas = new Date();
    fechaCorteDeudas.setMonth(fechaCorteDeudas.getMonth() - 4);
    const fechaCorteStr = fechaCorteDeudas.toISOString().split('T')[0];

    // CONSULTA: Solo remisiones desde la fecha de corte
    const q = query(
        remisionesRef,
        where("idCliente", "==", clienteId),
        where("fechaRecibido", ">=", fechaCorteStr),
        where("estado", "!=", "Anulada")
    );

    const snapshot = await getDocs(q);

    let comprasMesActual = 0;
    let acumuladoDeudaTotal = 0;
    let remisionesConSaldo = [];

    snapshot.forEach(docSnap => {
        const r = docSnap.data();
        const id = docSnap.id;

        // 1. Sumar a compras solo si es del mes actual
        if (r.fechaRecibido >= primerDiaMes) {
            comprasMesActual += (r.valorTotal || 0);
        }

        // 2. Calcular saldo pendiente (Confirmados vs Total)
        const pagado = (r.payments || [])
            .filter(p => p.status === 'confirmado')
            .reduce((acc, p) => acc + p.amount, 0);

        const saldo = r.valorTotal - pagado;

        // 3. Si hay deuda, la guardamos
        if (saldo > 100) {
            acumuladoDeudaTotal += saldo;
            remisionesConSaldo.push({ id, ...r, saldoCalculado: saldo });
        }
    });

    return {
        comprasMes: comprasMesActual,
        totalDeuda: acumuladoDeudaTotal,
        listaPendientes: remisionesConSaldo
    };
}

// Maneja la navegación tipo WhatsApp en móviles
function toggleMobileChatView(showChat) {
    const contactsContainer = document.getElementById('wa-contacts-container');
    const chatArea = document.getElementById('wa-chat-area');
    const noChatSelected = document.getElementById('wa-no-chat-selected');
    const chatActive = document.getElementById('wa-chat-active');

    if (window.innerWidth < 768) { // Solo lógica móvil
        if (showChat) {
            // 1. Ocultar lista de contactos
            contactsContainer.classList.add('hidden');
            // 2. Mostrar área de chat
            chatArea.classList.remove('hidden');
            chatArea.classList.add('flex', 'w-full');
            // 3. Ocultar mensaje de "selecciona un chat" y mostrar el chat real
            noChatSelected.classList.add('hidden');
            chatActive.classList.remove('hidden');
            chatActive.classList.add('flex');
        } else {
            // Volver a la lista
            contactsContainer.classList.remove('hidden');
            chatArea.classList.add('hidden');
            chatActive.classList.add('hidden');
            activeChatPhone = null;
        }
    }
}
// Listener para el botón volver
document.getElementById('wa-back-btn').addEventListener('click', () => toggleMobileChatView(false));

// Función para manejar la visibilidad de la info en móvil
function setupMobileInfoToggle() {
    const trigger = document.getElementById('wa-header-info-trigger');
    const sidebar = document.getElementById('wa-client-sidebar');
    const closeBtn = document.getElementById('close-info-mobile');

    if (trigger && sidebar) {
        trigger.addEventListener('click', (e) => {
            // Evitamos que se active si se hace clic en el botón "atrás" de la lista de chats
            if (e.target.closest('#wa-back-btn')) return;
            
            if (window.innerWidth < 1024) {
                sidebar.classList.add('active-mobile');
            }
        });
    }

    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            sidebar.classList.remove('active-mobile');
        });
    }
}

