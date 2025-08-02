// js/app.js (Versión Completa y Final)

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, updateEmail } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, collection, doc, setDoc, getDoc, getDocs, query, orderBy, onSnapshot, deleteDoc, updateDoc, addDoc, runTransaction, arrayUnion, where } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";

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
let app, auth, db, storage, functions;
try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    storage = getStorage(app);
    functions = getFunctions(app, 'us-central1');
} catch (e) {
    console.error("Error al inicializar Firebase.", e);
    document.body.innerHTML = `<h1>Error Crítico: No se pudo inicializar la aplicación.</h1>`;
}

// --- VISTAS Y ESTADO GLOBAL ---

const authView = document.getElementById('auth-view');
const appView = document.getElementById('app-view');
const deniedView = document.getElementById('denied-view');
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
let currentUser = null;
let currentUserData = null;
let allItems = [], allColores = [], allClientes = [], allProveedores = [], allGastos = [], allRemisiones = [], allUsers = [], allPendingLoans = [], profitLossChart = null;
let dynamicElementCounter = 0;
let isRegistering = false; // <-- Variable de "cerradura" para el registro
const ESTADOS_REMISION = ['Recibido', 'En Proceso', 'Procesado', 'Entregado'];
const ALL_MODULES = ['remisiones', 'facturacion', 'clientes', 'items', 'colores', 'gastos', 'proveedores', 'prestamos', 'empleados'];
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
function startApp() {
    if (isAppInitialized) return;

    // 1. Crear toda la estructura HTML de las vistas
    loadViewTemplates();

    // 2. Actualizar la visibilidad basada en el rol del usuario
    updateUIVisibility(currentUserData);

    // 3. Añadir todos los event listeners a los elementos que ya existen
    setupEventListeners();

    // 4. Empezar a cargar los datos desde Firebase
    loadAllData();

    // 5. Inicializar los buscadores interactivos AHORA que todo está listo
    setupSearchInputs();

    isAppInitialized = true;
}

function loadAllData() {
    activeListeners.push(loadClientes());
    activeListeners.push(loadProveedores());
    activeListeners.push(loadItems());
    activeListeners.push(loadColores());
    activeListeners.push(loadRemisiones());
    activeListeners.push(loadGastos());
    if (currentUserData && currentUserData.role === 'admin') {
        activeListeners.push(loadEmpleados());
        activeListeners.push(loadAllLoanRequests());
    }
}

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
    document.getElementById('view-remisiones').innerHTML = `<div class="grid grid-cols-1 lg:grid-cols-3 gap-8 max-w-6xl mx-auto"><div id="remision-form-container" class="lg:col-span-1 bg-white p-6 rounded-xl shadow-md"><h2 class="text-xl font-semibold mb-4">Nueva Remisión</h2><form id="remision-form" class="space-y-4"><div class="relative"><input type="text" id="cliente-search-input" autocomplete="off" placeholder="Buscar y seleccionar cliente..." class="w-full p-3 border border-gray-300 rounded-lg" required><input type="hidden" id="cliente-id-hidden" name="clienteId"><div id="cliente-search-results" class="search-results hidden"></div></div><div><label for="fecha-recibido" class="block text-sm font-medium text-gray-700">Fecha Recibido</label><input type="date" id="fecha-recibido" class="w-full p-3 border border-gray-300 rounded-lg mt-1 bg-gray-100" readonly></div><div class="border-t border-b border-gray-200 py-4"><h3 class="text-lg font-semibold mb-2">Ítems de la Remisión</h3><div id="items-container" class="space-y-4"></div><button type="button" id="add-item-btn" class="mt-4 w-full bg-gray-200 text-gray-700 font-semibold py-2 px-4 rounded-lg hover:bg-gray-300 transition-colors">+ Añadir Ítem</button></div><select id="forma-pago" class="w-full p-3 border border-gray-300 rounded-lg bg-white" required><option value="" disabled selected>Forma de Pago</option><option value="Pendiente">Pendiente</option><option value="Efectivo">Efectivo</option><option value="Nequi">Nequi</option><option value="Davivienda">Davivienda</option></select><div class="bg-gray-50 p-4 rounded-lg space-y-2"><div class="flex justify-between items-center"><span class="font-medium">Subtotal:</span><span id="subtotal" class="font-bold text-lg">$ 0</span></div><div class="flex justify-between items-center"><label for="incluir-iva" class="flex items-center space-x-2 cursor-pointer"><input type="checkbox" id="incluir-iva" class="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"><span>Incluir IVA (19%)</span></label><span id="valor-iva" class="font-medium text-gray-600">$ 0</span></div><hr><div class="flex justify-between items-center text-xl"><span class="font-bold">TOTAL:</span><span id="valor-total" class="font-bold text-indigo-600">$ 0</span></div></div><button type="submit" class="w-full bg-indigo-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-indigo-700 transition-colors">Guardar Remisión</button></form></div><div id="remisiones-list-container" class="lg:col-span-2 bg-white p-6 rounded-xl shadow-md"><div class="flex flex-col sm:flex-row justify-between sm:items-center mb-4 flex-wrap gap-4"><h2 class="text-xl font-semibold">Historial de Remisiones</h2><div class="flex items-center gap-2 flex-wrap w-full"><select id="filter-remisiones-month" class="p-2 border rounded-lg bg-white"></select><select id="filter-remisiones-year" class="p-2 border rounded-lg bg-white"></select><input type="search" id="search-remisiones" placeholder="Buscar..." class="p-2 border rounded-lg flex-grow"></div></div><div id="remisiones-list" class="space-y-3"></div></div></div>`;
    document.getElementById('view-facturacion').innerHTML = `<div class="bg-white p-6 rounded-xl shadow-md max-w-6xl mx-auto"><h2 class="text-2xl font-semibold mb-4">Gestión de Facturación</h2><div class="border-b border-gray-200 mb-6"><nav id="facturacion-nav" class="-mb-px flex space-x-6"><button id="tab-pendientes" class="dashboard-tab-btn active py-3 px-1 font-semibold">Pendientes</button><button id="tab-realizadas" class="dashboard-tab-btn py-3 px-1 font-semibold">Realizadas</button></nav></div><div id="view-pendientes"><h3 class="text-xl font-semibold text-gray-800 mb-4">Remisiones Pendientes de Facturar</h3><div id="facturacion-pendientes-list" class="space-y-3"></div></div><div id="view-realizadas" class="hidden"><h3 class="text-xl font-semibold text-gray-800 mb-4">Remisiones Facturadas</h3><div id="facturacion-realizadas-list" class="space-y-3"></div></div></div>`;
    document.getElementById('view-clientes').innerHTML = `<div class="grid grid-cols-1 lg:grid-cols-3 gap-8 max-w-6xl mx-auto"><div class="lg:col-span-1 bg-white p-6 rounded-xl shadow-md"><h2 class="text-xl font-semibold mb-4">Añadir Cliente</h2><form id="add-cliente-form" class="space-y-4"><input type="text" id="nuevo-cliente-nombre" placeholder="Nombre Completo" class="w-full p-3 border border-gray-300 rounded-lg" required><input type="email" id="nuevo-cliente-email" placeholder="Correo" class="w-full p-3 border border-gray-300 rounded-lg" required><input type="tel" id="nuevo-cliente-telefono1" placeholder="Teléfono 1" class="w-full p-3 border border-gray-300 rounded-lg" required><input type="tel" id="nuevo-cliente-telefono2" placeholder="Teléfono 2 (Opcional)" class="w-full p-3 border border-gray-300 rounded-lg"><input type="text" id="nuevo-cliente-nit" placeholder="NIT (Opcional)" class="w-full p-3 border border-gray-300 rounded-lg"><button type="submit" class="w-full bg-blue-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-blue-700">Registrar</button></form></div><div class="lg:col-span-2 bg-white p-6 rounded-xl shadow-md"><div class="flex justify-between items-center mb-4"><h2 class="text-xl font-semibold">Clientes</h2><input type="search" id="search-clientes" placeholder="Buscar..." class="p-2 border rounded-lg"></div><div id="clientes-list" class="space-y-3"></div></div></div>`;
    document.getElementById('view-proveedores').innerHTML = `<div class="grid grid-cols-1 lg:grid-cols-3 gap-8 max-w-6xl mx-auto"><div class="lg:col-span-1 bg-white p-6 rounded-xl shadow-md"><h2 class="text-xl font-semibold mb-4">Añadir Proveedor</h2><form id="add-proveedor-form" class="space-y-4"><input type="text" id="nuevo-proveedor-nombre" placeholder="Nombre del Proveedor" class="w-full p-3 border border-gray-300 rounded-lg" required><input type="text" id="nuevo-proveedor-contacto" placeholder="Nombre de Contacto" class="w-full p-3 border border-gray-300 rounded-lg"><input type="tel" id="nuevo-proveedor-telefono" placeholder="Teléfono" class="w-full p-3 border border-gray-300 rounded-lg"><input type="email" id="nuevo-proveedor-email" placeholder="Correo" class="w-full p-3 border border-gray-300 rounded-lg"><button type="submit" class="w-full bg-teal-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-teal-700">Registrar</button></form></div><div class="lg:col-span-2 bg-white p-6 rounded-xl shadow-md"><div class="flex justify-between items-center mb-4"><h2 class="text-xl font-semibold">Proveedores</h2><input type="search" id="search-proveedores" placeholder="Buscar..." class="p-2 border rounded-lg"></div><div id="proveedores-list" class="space-y-3"></div></div></div>`;
    document.getElementById('view-items').innerHTML = `<div class="grid grid-cols-1 lg:grid-cols-3 gap-8 max-w-6xl mx-auto"><div class="lg:col-span-1 bg-white p-6 rounded-xl shadow-md"><h2 class="text-xl font-semibold mb-4">Añadir Ítem</h2><form id="add-item-form" class="space-y-4"><input type="text" id="nuevo-item-ref" placeholder="Referencia (ej. P-001)" class="w-full p-3 border border-gray-300 rounded-lg" required><input type="text" id="nuevo-item-desc" placeholder="Descripción del Ítem o Servicio" class="w-full p-3 border border-gray-300 rounded-lg" required><button type="submit" class="w-full bg-green-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-green-700">Registrar</button></form></div><div class="lg:col-span-2 bg-white p-6 rounded-xl shadow-md"><div class="flex justify-between items-center mb-4"><h2 class="text-xl font-semibold">Catálogo de Ítems</h2><input type="search" id="search-items" placeholder="Buscar..." class="p-2 border rounded-lg"></div><div id="items-list" class="space-y-3"></div></div></div>`;
    document.getElementById('view-colores').innerHTML = `<div class="grid grid-cols-1 lg:grid-cols-3 gap-8 max-w-6xl mx-auto"><div class="lg:col-span-1 bg-white p-6 rounded-xl shadow-md"><h2 class="text-xl font-semibold mb-4">Añadir Color</h2><form id="add-color-form" class="space-y-4"><input type="text" id="nuevo-color-nombre" placeholder="Nombre del Color (ej. RAL 7016)" class="w-full p-3 border border-gray-300 rounded-lg" required><button type="submit" class="w-full bg-purple-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-purple-700">Registrar</button></form></div><div class="lg:col-span-2 bg-white p-6 rounded-xl shadow-md"><div class="flex justify-between items-center mb-4"><h2 class="text-xl font-semibold">Catálogo de Colores</h2><input type="search" id="search-colores" placeholder="Buscar..." class="p-2 border rounded-lg"></div><div id="colores-list" class="space-y-3"></div></div></div>`;
    document.getElementById('view-gastos').innerHTML = `<div class="grid grid-cols-1 lg:grid-cols-3 gap-8 max-w-6xl mx-auto"><div class="lg:col-span-1 bg-white p-6 rounded-xl shadow-md"><h2 class="text-xl font-semibold mb-4">Nuevo Gasto</h2><form id="add-gasto-form" class="space-y-4"><div><label for="gasto-fecha">Fecha</label><input type="date" id="gasto-fecha" class="w-full p-3 border border-gray-300 rounded-lg mt-1" required></div><div class="relative"><label for="proveedor-search-input">Proveedor</label><input type="text" id="proveedor-search-input" autocomplete="off" placeholder="Buscar..." class="w-full p-3 border border-gray-300 rounded-lg mt-1" required><input type="hidden" id="proveedor-id-hidden" name="proveedorId"><div id="proveedor-search-results" class="search-results hidden"></div></div><input type="text" id="gasto-factura" placeholder="N° de Factura (Opcional)" class="w-full p-3 border border-gray-300 rounded-lg"><input type="text" id="gasto-valor-total" inputmode="numeric" placeholder="Valor Total" class="w-full p-3 border border-gray-300 rounded-lg" required><label class="flex items-center space-x-2"><input type="checkbox" id="gasto-iva" class="h-4 w-4 rounded border-gray-300"><span>IVA del 19% incluido</span></label><div><label for="gasto-fuente">Fuente del Pago</label><select id="gasto-fuente" class="w-full p-3 border border-gray-300 rounded-lg mt-1 bg-white" required><option>Efectivo</option><option>Nequi</option><option>Davivienda</option></select></div><button type="submit" class="w-full bg-orange-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-orange-700">Registrar</button></form></div><div class="lg:col-span-2 bg-white p-6 rounded-xl shadow-md"><div class="flex flex-col sm:flex-row justify-between sm:items-center mb-4 gap-4"><h2 class="text-xl font-semibold flex-shrink-0">Historial de Gastos</h2><div class="flex flex-wrap items-center gap-2 w-full sm:w-auto justify-start sm:justify-end"><select id="filter-gastos-month" class="p-2 border rounded-lg bg-white"></select><select id="filter-gastos-year" class="p-2 border rounded-lg bg-white"></select><input type="search" id="search-gastos" placeholder="Buscar..." class="p-2 border rounded-lg flex-grow sm:flex-grow-0 sm:w-40"></div></div><div id="gastos-list" class="space-y-3"></div></div></div>`;
    document.getElementById('view-empleados').innerHTML = `<div class="bg-white p-6 rounded-xl shadow-md max-w-4xl mx-auto"><h2 class="text-xl font-semibold mb-4">Gestión de Empleados</h2><div id="empleados-list" class="space-y-3"></div></div>`;
    // Nos aseguramos de limpiar listeners anteriores por si acaso
    unsubscribeAllListeners();
    // Al cargar los datos, guardamos la función de desuscripción que retorna cada listener
    activeListeners.push(loadClientes());
    activeListeners.push(loadProveedores());
    activeListeners.push(loadItems());
    activeListeners.push(loadColores());
    activeListeners.push(loadRemisiones());
    activeListeners.push(loadGastos());
    if (currentUserData && currentUserData.role === 'admin') {
        activeListeners.push(loadEmpleados());
    }
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


function loadInitialData() {
    // Cargar plantillas HTML en las vistas
    document.getElementById('view-remisiones').innerHTML = `<div class="grid grid-cols-1 lg:grid-cols-3 gap-8 max-w-6xl mx-auto"><div id="remision-form-container" class="lg:col-span-1 bg-white p-6 rounded-xl shadow-md"><h2 class="text-xl font-semibold mb-4">Nueva Remisión</h2><form id="remision-form" class="space-y-4"><div class="relative"><input type="text" id="cliente-search-input" autocomplete="off" placeholder="Buscar y seleccionar cliente..." class="w-full p-3 border border-gray-300 rounded-lg" required><input type="hidden" id="cliente-id-hidden" name="clienteId"><div id="cliente-search-results" class="search-results hidden"></div></div><div><label for="fecha-recibido" class="block text-sm font-medium text-gray-700">Fecha Recibido</label><input type="date" id="fecha-recibido" class="w-full p-3 border border-gray-300 rounded-lg mt-1 bg-gray-100" readonly></div><div class="border-t border-b border-gray-200 py-4"><h3 class="text-lg font-semibold mb-2">Ítems de la Remisión</h3><div id="items-container" class="space-y-4"></div><button type="button" id="add-item-btn" class="mt-4 w-full bg-gray-200 text-gray-700 font-semibold py-2 px-4 rounded-lg hover:bg-gray-300 transition-colors">+ Añadir Ítem</button></div><select id="forma-pago" class="w-full p-3 border border-gray-300 rounded-lg bg-white" required><option value="" disabled selected>Forma de Pago</option><option value="Pendiente">Pendiente</option><option value="Efectivo">Efectivo</option><option value="Nequi">Nequi</option><option value="Davivienda">Davivienda</option></select><div class="bg-gray-50 p-4 rounded-lg space-y-2"><div class="flex justify-between items-center"><span class="font-medium">Subtotal:</span><span id="subtotal" class="font-bold text-lg">$ 0</span></div><div class="flex justify-between items-center"><label for="incluir-iva" class="flex items-center space-x-2 cursor-pointer"><input type="checkbox" id="incluir-iva" class="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"><span>Incluir IVA (19%)</span></label><span id="valor-iva" class="font-medium text-gray-600">$ 0</span></div><hr><div class="flex justify-between items-center text-xl"><span class="font-bold">TOTAL:</span><span id="valor-total" class="font-bold text-indigo-600">$ 0</span></div></div><button type="submit" class="w-full bg-indigo-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-indigo-700 transition-colors">Guardar Remisión</button></form></div><div id="remisiones-list-container" class="lg:col-span-2 bg-white p-6 rounded-xl shadow-md"><div class="flex flex-col sm:flex-row justify-between sm:items-center mb-4 flex-wrap gap-4"><h2 class="text-xl font-semibold">Historial de Remisiones</h2><div class="flex items-center gap-2 flex-wrap w-full"><select id="filter-remisiones-month" class="p-2 border rounded-lg bg-white"></select><select id="filter-remisiones-year" class="p-2 border rounded-lg bg-white"></select><input type="search" id="search-remisiones" placeholder="Buscar..." class="p-2 border rounded-lg flex-grow"></div></div><div id="remisiones-list" class="space-y-3"></div></div></div>`;
    // ... (El resto de innerHTML para las otras vistas se mantiene igual)

    // El orden es importante: primero se actualiza la UI y luego se cargan los datos y listeners
    updateUIVisibility(currentUserData);
    loadClientes();
    loadProveedores();
    loadItems();
    loadColores();
    loadRemisiones();
    loadGastos();
    if (currentUserData && currentUserData.role === 'admin') loadEmpleados();
    setupEventListeners();
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

    const nombre = document.getElementById('register-name').value;
    const email = document.getElementById('register-email').value;
    const password = document.getElementById('register-password').value;
    // ... (captura los otros campos del formulario)

    showModalMessage("Registrando...", true);

    try {
        // --- LÓGICA SIMPLIFICADA ---
        const role = 'planta';
        const status = 'pending';
        const permissions = {
            remisiones: true, prestamos: true,
            facturacion: false, clientes: false, items: false,
            colores: false, gastos: false, proveedores: false, empleados: false
        };

        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        await setDoc(doc(db, "users", user.uid), {
            nombre, email, role, status, permissions,
            // ... (guarda los otros campos del formulario)
            creadoEn: new Date()
        });

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

// --- LÓGICA DE NAVEGACIÓN Y EVENTOS ---
function setupEventListeners() {
    const tabs = { remisiones: document.getElementById('tab-remisiones'), facturacion: document.getElementById('tab-facturacion'), clientes: document.getElementById('tab-clientes'), items: document.getElementById('tab-items'), colores: document.getElementById('tab-colores'), gastos: document.getElementById('tab-gastos'), proveedores: document.getElementById('tab-proveedores'), empleados: document.getElementById('tab-empleados') };
    const views = { remisiones: document.getElementById('view-remisiones'), facturacion: document.getElementById('view-facturacion'), clientes: document.getElementById('view-clientes'), items: document.getElementById('view-items'), colores: document.getElementById('view-colores'), gastos: document.getElementById('view-gastos'), proveedores: document.getElementById('view-proveedores'), empleados: document.getElementById('view-empleados') };
    Object.keys(tabs).forEach(key => { if (tabs[key]) tabs[key].addEventListener('click', () => switchView(key, tabs, views)) });
    const policyModal = document.getElementById('policy-modal');


    const facturacionPendientesTab = document.getElementById('tab-pendientes');
    const facturacionRealizadasTab = document.getElementById('tab-realizadas');
    const facturacionPendientesView = document.getElementById('view-pendientes');
    const facturacionRealizadasView = document.getElementById('view-realizadas');

    if (facturacionPendientesTab) {
        facturacionPendientesTab.addEventListener('click', () => {
            facturacionPendientesTab.classList.add('active');
            facturacionRealizadasTab.classList.remove('active');
            facturacionPendientesView.classList.remove('hidden');
            facturacionRealizadasView.classList.add('hidden');
        });
    }
    if (facturacionRealizadasTab) {
        facturacionRealizadasTab.addEventListener('click', () => {
            facturacionRealizadasTab.classList.add('active');
            facturacionPendientesTab.classList.remove('active');
            facturacionRealizadasView.classList.remove('hidden');
            facturacionPendientesView.classList.add('hidden');
        });
    }

    document.getElementById('add-color-form').addEventListener('submit', async (e) => { e.preventDefault(); const nuevoColor = { nombre: document.getElementById('nuevo-color-nombre').value, creadoEn: new Date() }; showModalMessage("Registrando color...", true); try { await addDoc(collection(db, "colores"), nuevoColor); e.target.reset(); hideModal(); showModalMessage("¡Color registrado!", false, 2000); } catch (error) { console.error(error); hideModal(); showModalMessage("Error al registrar color."); } });
    document.getElementById('add-item-form').addEventListener('submit', async (e) => { e.preventDefault(); const nuevoItem = { referencia: document.getElementById('nuevo-item-ref').value, descripcion: document.getElementById('nuevo-item-desc').value, creadoEn: new Date() }; showModalMessage("Registrando ítem...", true); try { await addDoc(collection(db, "items"), nuevoItem); e.target.reset(); hideModal(); showModalMessage("¡Ítem registrado!", false, 2000); } catch (error) { console.error(error); hideModal(); showModalMessage("Error al registrar ítem."); } });
    document.getElementById('add-cliente-form').addEventListener('submit', async (e) => { e.preventDefault(); const nuevoCliente = { nombre: document.getElementById('nuevo-cliente-nombre').value, email: document.getElementById('nuevo-cliente-email').value, telefono1: document.getElementById('nuevo-cliente-telefono1').value, telefono2: document.getElementById('nuevo-cliente-telefono2').value, nit: document.getElementById('nuevo-cliente-nit').value || '', creadoEn: new Date() }; showModalMessage("Registrando cliente...", true); try { await addDoc(collection(db, "clientes"), nuevoCliente); e.target.reset(); hideModal(); showModalMessage("¡Cliente registrado!", false, 2000); } catch (error) { console.error(error); hideModal(); showModalMessage("Error al registrar cliente."); } });
    document.getElementById('add-proveedor-form').addEventListener('submit', handleProveedorSubmit);
    document.getElementById('add-gasto-form').addEventListener('submit', handleGastoSubmit);
    document.getElementById('remision-form').addEventListener('submit', handleRemisionSubmit);
    document.getElementById('add-item-btn').addEventListener('click', () => {
        const itemsContainer = document.getElementById('items-container');
        if (itemsContainer) itemsContainer.appendChild(createItemElement());
    });
    const ivaCheckbox = document.getElementById('incluir-iva');
    if (ivaCheckbox) ivaCheckbox.addEventListener('input', calcularTotales);
    document.getElementById('summary-btn').addEventListener('click', showDashboardModal);
    document.getElementById('edit-profile-btn').addEventListener('click', showEditProfileModal);
    document.getElementById('loan-request-btn').addEventListener('click', showLoanRequestModal);
    document.getElementById('show-policy-link').addEventListener('click', (e) => {
        e.preventDefault();
        policyModal.classList.remove('hidden');
    });

    document.getElementById('close-policy-modal').addEventListener('click', () => {
        policyModal.classList.add('hidden');
    });
    document.getElementById('accept-policy-btn').addEventListener('click', () => {
        policyModal.classList.add('hidden');
    });

    // Delegación de eventos para los botones de la sección de empleados
    const empleadosView = document.getElementById('view-empleados');
    if (empleadosView) {
        empleadosView.addEventListener('click', async (e) => {
            const target = e.target;

            // Lógica para los botones de estado
            if (target.classList.contains('user-status-btn')) {
                const uid = target.dataset.uid;
                const newStatus = target.dataset.status;
                if (confirm(`¿Estás seguro de que quieres cambiar el estado de este usuario a "${newStatus}"?`)) {
                    try {
                        await updateDoc(doc(db, "users", uid), { status: newStatus });
                        showTemporaryMessage("Estado del usuario actualizado.", "success");
                    } catch (error) {
                        console.error("Error al actualizar estado:", error);
                        showTemporaryMessage("No se pudo actualizar el estado.", "error");
                    }
                }
            }

            // Lógica para el botón de gestionar
            if (target.classList.contains('manage-user-btn')) {
                showAdminEditUserModal(JSON.parse(target.dataset.userJson));
            }
        });
    }


    // Listeners para buscadores
    document.getElementById('search-remisiones').addEventListener('input', renderRemisiones);
    document.getElementById('search-clientes').addEventListener('input', renderClientes);
    document.getElementById('search-proveedores').addEventListener('input', renderProveedores);
    document.getElementById('search-items').addEventListener('input', renderItems);
    document.getElementById('search-colores').addEventListener('input', renderColores);
    document.getElementById('search-gastos').addEventListener('input', renderGastos);

    // Listeners para filtros de fecha
    populateDateFilters('filter-remisiones');
    populateDateFilters('filter-gastos');
    document.getElementById('filter-remisiones-month').addEventListener('change', renderRemisiones);
    document.getElementById('filter-remisiones-year').addEventListener('change', renderRemisiones);
    document.getElementById('filter-gastos-month').addEventListener('change', renderGastos);
    document.getElementById('filter-gastos-year').addEventListener('change', renderGastos);

    // Fecha de recibido
    const fechaRecibidoInput = document.getElementById('fecha-recibido');
    if (fechaRecibidoInput) {
        fechaRecibidoInput.value = new Date().toISOString().split('T')[0];
    }

    // Listeners para formateo de moneda
    document.getElementById('view-gastos').addEventListener('focusout', (e) => { if (e.target.id === 'gasto-valor-total') { formatCurrencyInput(e.target); } });
    document.getElementById('view-gastos').addEventListener('focus', (e) => { if (e.target.id === 'gasto-valor-total') { unformatCurrencyInput(e.target); } });
    document.getElementById('view-remisiones').addEventListener('focusout', (e) => { if (e.target.classList.contains('item-valor-unitario')) { formatCurrencyInput(e.target); calcularTotales(); } });
    document.getElementById('view-remisiones').addEventListener('focus', (e) => { if (e.target.classList.contains('item-valor-unitario')) { unformatCurrencyInput(e.target); } });

    // Listener para el nuevo botón de préstamos del admin
    document.getElementById('view-all-loans-btn').addEventListener('click', () => {
        showAllLoansModal(allPendingLoans);
    });
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
    if (!currentUserData || currentUserData.role !== 'admin' || !empleadosListEl) {
        return () => { }; // Retorna una función vacía si no hay nada que hacer
    }
    const q = query(collection(db, "users"));
    // Añadir 'return' aquí
    return onSnapshot(q, (snapshot) => {
        const users = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        allUsers = snapshot.docs.map(d => ({ id: d.id, ...d.data() })); // Guardamos los usuarios en la variable global
        empleadosListEl.innerHTML = '';
        users.filter(u => u.id !== currentUser.uid).forEach(empleado => {
            const el = document.createElement('div');
            el.className = 'border p-4 rounded-lg flex justify-between items-center';
            el.innerHTML = `
                <div>
                    <p class="font-semibold">${empleado.nombre} <span class="text-sm font-normal text-gray-500">(${empleado.role})</span></p>
                    <p class="text-sm text-gray-600">${empleado.email}</p>
                </div>
                <div class="flex flex-wrap gap-2">
                    <button data-user-json='${JSON.stringify(empleado)}' class="manage-rrhh-docs-btn bg-green-600 text-white px-3 py-1 rounded-lg text-sm font-semibold hover:bg-green-700">Recursos Humanos</button>
                    <button data-user-json='${JSON.stringify(empleado)}' class="manage-user-btn bg-blue-600 text-white px-3 py-1 rounded-lg text-sm font-semibold hover:bg-blue-700">Gestionar</button>
                    <button data-uid="${empleado.id}" class="delete-user-btn bg-red-600 text-white p-2 rounded hover:bg-red-700">Eliminar</button>
                </div>`;
            empleadosListEl.appendChild(el);
        });
        document.querySelectorAll('.manage-rrhh-docs-btn').forEach(btn => btn.addEventListener('click', (e) => showRRHHModal(JSON.parse(e.currentTarget.dataset.userJson))));
        document.querySelectorAll('.manage-user-btn').forEach(btn => btn.addEventListener('click', (e) => showAdminEditUserModal(JSON.parse(e.currentTarget.dataset.userJson))));
        document.querySelectorAll('.delete-user-btn').forEach(btn => { btn.addEventListener('click', async (e) => { const uid = e.target.dataset.uid; if (confirm('¿Estás seguro de que quieres eliminar este usuario? Esta acción no se puede deshacer.')) { await deleteDoc(doc(db, "users", uid)); showModalMessage("Usuario eliminado de Firestore.", false, 2000); } }); });
    });
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
// **** FUNCIÓN AÑADIDA QUE FALTABA ****
function renderEmpleados(users) {
    const empleadosListEl = document.getElementById('empleados-list');
    if (!empleadosListEl) return;

    empleadosListEl.innerHTML = '';
    // Ordenar usuarios para mostrar los pendientes primero
    users.sort((a, b) => {
        if (a.status === 'pending' && b.status !== 'pending') return -1;
        if (a.status !== 'pending' && b.status === 'pending') return 1;
        return a.nombre.localeCompare(b.nombre);
    });

    users.filter(u => u.id !== currentUser.uid && u.status !== 'archived').forEach(empleado => {
        const el = document.createElement('div');
        let statusBadge = '';
        let actionButtons = '';

        switch (empleado.status) {
            case 'pending':
                statusBadge = `<span class="text-xs font-semibold bg-yellow-200 text-yellow-800 px-2 py-1 rounded-full">Pendiente</span>`;
                actionButtons = `<button data-uid="${empleado.id}" data-status="active" class="user-status-btn bg-green-500 text-white text-xs px-3 py-1 rounded-full hover:bg-green-600">Activar</button>`;
                break;
            case 'active':
                statusBadge = `<span class="text-xs font-semibold bg-green-200 text-green-800 px-2 py-1 rounded-full">Activo</span>`;
                actionButtons = `<button data-uid="${empleado.id}" data-status="inactive" class="user-status-btn bg-yellow-500 text-white text-xs px-3 py-1 rounded-full hover:bg-yellow-600">Desactivar</button>`;
                break;
            case 'inactive':
                statusBadge = `<span class="text-xs font-semibold bg-gray-200 text-gray-800 px-2 py-1 rounded-full">Inactivo</span>`;
                actionButtons = `<button data-uid="${empleado.id}" data-status="active" class="user-status-btn bg-green-500 text-white text-xs px-3 py-1 rounded-full hover:bg-green-600">Activar</button>`;
                break;
        }

        el.className = 'border p-3 rounded-lg';
        el.innerHTML = `
            <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center">
                <div>
                    <p class="font-semibold">${empleado.nombre} <span class="text-sm font-normal text-gray-500">(${empleado.role})</span></p>
                    <p class="text-sm text-gray-600">${empleado.email}</p>
                </div>
                <div class="flex items-center gap-2 mt-2 sm:mt-0">
                    ${statusBadge}
                    ${actionButtons}
                    <button data-uid="${empleado.id}" data-status="archived" class="user-status-btn bg-red-500 text-white text-xs px-3 py-1 rounded-full hover:bg-red-600">Archivar</button>
                    <button data-user-json='${JSON.stringify(empleado)}' class="manage-user-btn bg-blue-600 text-white text-xs px-3 py-1 rounded-full hover:bg-blue-700">Gestionar</button>
                </div>
            </div>`;
        empleadosListEl.appendChild(el);
    });
}


function renderClientes() {
    const clientesListEl = document.getElementById('clientes-list');
    if (!clientesListEl) return;
    const searchTerm = document.getElementById('search-clientes').value.toLowerCase();

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

    const filtered = clientesConHistorial.filter(c =>
        c.nombre.toLowerCase().includes(searchTerm) ||
        c.email.toLowerCase().includes(searchTerm) ||
        (c.telefono1 && c.telefono1.includes(searchTerm)) ||
        (c.telefono2 && c.telefono2.includes(searchTerm))
    );

    clientesListEl.innerHTML = '';
    if (filtered.length === 0) {
        clientesListEl.innerHTML = '<p class="text-center text-gray-500 py-8">No se encontraron clientes.</p>';
        return;
    }

    filtered.forEach(cliente => {
        const clienteDiv = document.createElement('div');
        clienteDiv.className = 'border p-4 rounded-lg flex justify-between items-start';
        const telefonos = [cliente.telefono1, cliente.telefono2].filter(Boolean).join(' | ');
        const editButton = (currentUserData && currentUserData.role === 'admin')
            ? `<button data-client-json='${JSON.stringify(cliente)}' class="edit-client-btn bg-gray-200 text-gray-700 px-3 py-1 rounded-lg text-sm font-semibold hover:bg-gray-300 w-full text-center">Editar</button>`
            : '';

        clienteDiv.innerHTML = `
            <div class="flex-grow">
                <p class="font-semibold text-lg">${cliente.nombre}</p>
                <p class="text-sm text-gray-600">${cliente.email} | ${telefonos}</p>
                ${cliente.nit ? `<p class="text-sm text-gray-500">NIT: ${cliente.nit}</p>` : ''}
                <div class="mt-2 pt-2 border-t border-gray-100 text-sm">
                    <p><span class="font-semibold">Última Compra:</span> ${cliente.ultimaCompra}</p>
                    <p><span class="font-semibold">Total Comprado:</span> ${formatCurrency(cliente.totalComprado)}</p>
                </div>
            </div>
            <div class="flex-shrink-0 flex flex-col items-end gap-2">
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
function loadRemisiones() {
    const q = query(collection(db, "remisiones"), orderBy("numeroRemision", "desc"));
    return onSnapshot(q, (snapshot) => {
        allRemisiones = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderRemisiones();
        renderFacturacion();
        renderClientes();
    });
}
function renderRemisiones() {
    const remisionesListEl = document.getElementById('remisiones-list');
    if (!remisionesListEl) return;

    const isAdmin = currentUserData && currentUserData.role === 'admin';
    const isPlanta = currentUserData && currentUserData.role === 'planta';
    const month = document.getElementById('filter-remisiones-month').value;
    const year = document.getElementById('filter-remisiones-year').value;
    const searchTerm = document.getElementById('search-remisiones').value.toLowerCase();

    let filtered = allRemisiones;

    if (isPlanta) {
        const allowedStates = ['Recibido', 'En Proceso', 'Procesado'];
        filtered = filtered.filter(r => allowedStates.includes(r.estado));
    }

    if (year !== 'all') {
        filtered = filtered.filter(r => new Date(r.fechaRecibido).getFullYear() == year);
    }
    if (month !== 'all') {
        filtered = filtered.filter(r => new Date(r.fechaRecibido).getMonth() == month);
    }
    if (searchTerm) {
        filtered = filtered.filter(r => r.clienteNombre.toLowerCase().includes(searchTerm) || r.numeroRemision.toString().includes(searchTerm));
    }

    remisionesListEl.innerHTML = '';
    if (filtered.length === 0) { remisionesListEl.innerHTML = '<p class="text-center text-gray-500 py-8">No se encontraron remisiones.</p>'; return; }
    filtered.forEach((remision) => {
        const el = document.createElement('div');
        const esAnulada = remision.estado === 'Anulada';
        const esEntregada = remision.estado === 'Entregado';
        el.className = `border p-4 rounded-lg flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 ${esAnulada ? 'remision-anulada' : ''}`;

        const totalPagadoConfirmado = (remision.payments || []).filter(p => p.status === 'confirmado').reduce((sum, p) => sum + p.amount, 0);
        const totalAbonado = (remision.payments || []).reduce((sum, p) => sum + p.amount, 0);
        const saldoPendiente = remision.valorTotal - totalPagadoConfirmado;

        let paymentStatusBadge = '';
        if (!esAnulada) {
            if (saldoPendiente <= 0) {
                paymentStatusBadge = `<span class="payment-status payment-pagado">Pagado</span>`;
            } else if (isPlanta) {
                paymentStatusBadge = `<span class="payment-status payment-pendiente">Pendiente</span>`;
            } else if (totalAbonado > 0) {
                paymentStatusBadge = `<span class="payment-status payment-abono">Abono</span>`;
            } else {
                paymentStatusBadge = `<span class="payment-status payment-pendiente">Pendiente</span>`;
            }
        }

        const pdfUrl = isPlanta ? remision.pdfPlantaUrl : remision.pdfUrl;
        const pdfButton = pdfUrl ? `<button data-pdf-url="${pdfUrl}" data-remision-num="${remision.numeroRemision}" class="view-pdf-btn w-full bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-green-700 transition text-center">Ver Remisión</button>` : `<button class="w-full bg-gray-400 text-white px-4 py-2 rounded-lg text-sm font-semibold btn-disabled">Generando PDF...</button>`;

        const anularButton = (esAnulada || esEntregada || isPlanta || (remision.payments && remision.payments.length > 0))
            ? ''
            : `<button data-remision-id="${remision.id}" class="anular-btn w-full bg-yellow-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-yellow-600 transition">Anular</button>`;

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
    document.querySelectorAll('.anular-btn').forEach(button => button.addEventListener('click', (e) => { const remisionId = e.currentTarget.dataset.remisionId; if (confirm(`¿Estás seguro de que quieres ANULAR esta remisión? Se enviará un correo de notificación al cliente.`)) { handleAnularRemision(remisionId); } }));
    document.querySelectorAll('.status-update-btn').forEach(button => button.addEventListener('click', (e) => { const remisionId = e.currentTarget.dataset.remisionId; const currentStatus = e.currentTarget.dataset.currentStatus; handleStatusUpdate(remisionId, currentStatus); }));
    document.querySelectorAll('.view-pdf-btn').forEach(button => button.addEventListener('click', (e) => { const pdfUrl = e.currentTarget.dataset.pdfUrl; const remisionNum = e.currentTarget.dataset.remisionNum; showPdfModal(pdfUrl, `Remisión N° ${remisionNum}`); }));
    document.querySelectorAll('.payment-btn').forEach(button => button.addEventListener('click', (e) => { const remision = JSON.parse(e.currentTarget.dataset.remisionJson); showPaymentModal(remision); }));
    document.querySelectorAll('.discount-btn').forEach(button => button.addEventListener('click', (e) => { const remision = JSON.parse(e.currentTarget.dataset.remisionJson); showDiscountModal(remision); }));
}
function loadGastos() {
    const q = query(collection(db, "gastos"), orderBy("fecha", "desc"));
    return onSnapshot(q, (snapshot) => {
        allGastos = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderGastos();
    });
}
function renderGastos() {
    const gastosListEl = document.getElementById('gastos-list');
    if (!gastosListEl) return;

    const month = document.getElementById('filter-gastos-month').value;
    const year = document.getElementById('filter-gastos-year').value;
    const searchTerm = document.getElementById('search-gastos').value.toLowerCase();

    let filtered = allGastos;

    if (year !== 'all') {
        filtered = filtered.filter(g => new Date(g.fecha).getFullYear() == year);
    }
    if (month !== 'all') {
        filtered = filtered.filter(g => new Date(g.fecha).getMonth() == month);
    }
    if (searchTerm) {
        filtered = filtered.filter(g => g.proveedorNombre.toLowerCase().includes(searchTerm) || (g.numeroFactura && g.numeroFactura.toLowerCase().includes(searchTerm)));
    }

    gastosListEl.innerHTML = '';
    if (filtered.length === 0) {
        gastosListEl.innerHTML = '<p class="text-center text-gray-500 py-8">No hay gastos registrados.</p>';
        return;
    }

    filtered.forEach((gasto) => {
        const el = document.createElement('div');
        // **** ESTA LÍNEA ES LA CORRECCIÓN ****
        el.className = 'border p-4 rounded-lg flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2';
        el.innerHTML = `
            <div class="w-full sm:w-auto">
                <p class="font-semibold">${gasto.proveedorNombre}</p>
                <p class="text-sm text-gray-600">${gasto.fecha} ${gasto.numeroFactura ? `| Factura: ${gasto.numeroFactura}` : ''}</p>
            </div>
            <div class="text-left sm:text-right w-full sm:w-auto mt-2 sm:mt-0">
                <p class="font-bold text-lg text-red-600">${formatCurrency(gasto.valorTotal)}</p>
                <p class="text-sm text-gray-500">Pagado con: ${gasto.fuentePago}</p>
            </div>
        `;
        gastosListEl.appendChild(el);
    });
}
function renderFacturacion() {
    const pendientesListEl = document.getElementById('facturacion-pendientes-list');
    const realizadasListEl = document.getElementById('facturacion-realizadas-list');
    if (!pendientesListEl || !realizadasListEl) return;

    const remisionesParaFacturar = allRemisiones.filter(r => r.incluyeIVA && r.estado !== 'Anulada');

    const pendientes = remisionesParaFacturar.filter(r => !r.facturado);
    const realizadas = remisionesParaFacturar.filter(r => r.facturado);

    pendientesListEl.innerHTML = '';
    if (pendientes.length === 0) {
        pendientesListEl.innerHTML = '<p class="text-center text-gray-500 py-8">No hay remisiones pendientes de facturar.</p>';
    } else {
        pendientes.forEach(remision => {
            const el = document.createElement('div');
            el.className = 'border p-4 rounded-lg flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4';
            el.innerHTML = `
                <div class="flex-grow">
                    <div class="flex items-center gap-3 flex-wrap">
                        <span class="remision-id">N° ${remision.numeroRemision}</span>
                        <p class="font-semibold text-lg">${remision.clienteNombre}</p>
                    </div>
                    <p class="text-sm text-gray-600 mt-1">Fecha: ${remision.fechaRecibido} &bull; Total: <span class="font-bold">${formatCurrency(remision.valorTotal)}</span></p>
                </div>
                <div class="flex-shrink-0 flex items-center gap-2">
                    <button data-pdf-url="${remision.pdfUrl}" data-remision-num="${remision.numeroRemision}" class="view-pdf-btn bg-gray-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-gray-600">Ver Remisión</button>
                    <button data-remision-id="${remision.id}" class="facturar-btn bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-blue-700">Facturar</button>
                </div>
            `;
            pendientesListEl.appendChild(el);
        });
    }

    realizadasListEl.innerHTML = '';
    if (realizadas.length === 0) {
        realizadasListEl.innerHTML = '<p class="text-center text-gray-500 py-8">No hay remisiones facturadas.</p>';
    } else {
        realizadas.forEach(remision => {
            const el = document.createElement('div');
            el.className = 'border p-4 rounded-lg flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4';

            let facturaButtons = '';
            if (remision.facturaPdfUrl) {
                facturaButtons = `<button data-pdf-url="${remision.facturaPdfUrl}" data-remision-num="${remision.numeroFactura || remision.numeroRemision}" class="view-factura-pdf-btn bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-green-700">Ver Factura</button>`;
            } else {
                facturaButtons = `<button data-remision-id="${remision.id}" class="facturar-btn bg-orange-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-orange-600">Adjuntar Factura</button>`;
            }

            el.innerHTML = `
                <div class="flex-grow">
                    <div class="flex items-center gap-3 flex-wrap">
                        <span class="remision-id">N° ${remision.numeroRemision}</span>
                        <p class="font-semibold text-lg">${remision.clienteNombre}</p>
                    </div>
                    <p class="text-sm text-gray-600 mt-1">Fecha: ${remision.fechaRecibido} &bull; Total: <span class="font-bold">${formatCurrency(remision.valorTotal)}</span></p>
                </div>
                <div class="flex-shrink-0 flex items-center gap-2">
                     <div class="text-right">
                        <span class="status-badge status-entregado">Facturado</span>
                        ${remision.numeroFactura ? `<p class="text-sm text-gray-600 mt-1">Factura N°: <span class="font-semibold">${remision.numeroFactura}</span></p>` : ''}
                    </div>
                    ${facturaButtons}
                    <button data-pdf-url="${remision.pdfUrl}" data-remision-num="${remision.numeroRemision}" class="view-pdf-btn bg-gray-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-gray-600">Ver Remisión</button>
                </div>
            `;
            realizadasListEl.appendChild(el);
        });
    }

    document.querySelectorAll('.facturar-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const remisionId = e.currentTarget.dataset.remisionId;
            showFacturaModal(remisionId);
        });
    });
    document.querySelectorAll('.view-pdf-btn').forEach(button => button.addEventListener('click', (e) => { const pdfUrl = e.currentTarget.dataset.pdfUrl; const remisionNum = e.currentTarget.dataset.remisionNum; showPdfModal(pdfUrl, `Remisión N° ${remisionNum}`); }));
    document.querySelectorAll('.view-factura-pdf-btn').forEach(button => button.addEventListener('click', (e) => { const pdfUrl = e.currentTarget.dataset.pdfUrl; const remisionNum = e.currentTarget.dataset.remisionNum; showPdfModal(pdfUrl, `Factura N° ${remisionNum}`); }));
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
            numeroFactura: null
        };
        await addDoc(collection(db, "remisiones"), nuevaRemision);

        // --- LÍNEA CLAVE AÑADIDA ---
        // Forzamos la actualización de la lista visualmente.
        // onSnapshot debería hacer esto, pero si no lo hace, esta línea lo garantiza.
        renderRemisiones();

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

    document.addEventListener('click', (e) => {
        if (!searchInput.contains(e.target) && !resultsContainer.contains(e.target)) {
            resultsContainer.classList.add('hidden');
        }
    });
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
function calcularTotales() { const itemsContainer = document.getElementById('items-container'); const ivaCheckbox = document.getElementById('incluir-iva'); const subtotalEl = document.getElementById('subtotal'); const valorIvaEl = document.getElementById('valor-iva'); const valorTotalEl = document.getElementById('valor-total'); if (!itemsContainer || !ivaCheckbox || !subtotalEl || !valorIvaEl || !valorTotalEl) return { subtotalGeneral: 0, valorIVA: 0, total: 0 }; let subtotalGeneral = 0; itemsContainer.querySelectorAll('.item-row').forEach(row => { const cantidad = parseFloat(row.querySelector('.item-cantidad').value) || 0; const valorUnitario = unformatCurrency(row.querySelector('.item-valor-unitario').value); subtotalGeneral += cantidad * valorUnitario; }); const incluyeIVA = ivaCheckbox.checked; const valorIVA = incluyeIVA ? subtotalGeneral * 0.19 : 0; const total = subtotalGeneral + valorIVA; subtotalEl.textContent = formatCurrency(subtotalGeneral); valorIvaEl.textContent = formatCurrency(valorIVA); valorTotalEl.textContent = formatCurrency(total); return { subtotalGeneral, valorIVA, total }; }
function showEditClientModal(client) { const modalContentWrapper = document.getElementById('modal-content-wrapper'); modalContentWrapper.innerHTML = `<div class="bg-white rounded-lg p-6 shadow-xl max-w-sm w-full mx-auto text-center"><h2 class="text-xl font-semibold mb-4">Editar Cliente</h2><form id="edit-client-form" class="space-y-4 text-left"><input type="hidden" id="edit-client-id" value="${client.id}"><div><label for="edit-client-name" class="block text-sm font-medium text-gray-700">Nombre</label><input type="text" id="edit-client-name" class="w-full p-2 border border-gray-300 rounded-lg mt-1" value="${client.nombre}" required></div><div><label for="edit-client-email" class="block text-sm font-medium text-gray-700">Correo</label><input type="email" id="edit-client-email" class="w-full p-2 border border-gray-300 rounded-lg mt-1" value="${client.email}" required></div><div><label for="edit-client-phone1" class="block text-sm font-medium text-gray-700">Teléfono 1</label><input type="tel" id="edit-client-phone1" class="w-full p-2 border border-gray-300 rounded-lg mt-1" value="${client.telefono1 || ''}" required></div><div><label for="edit-client-phone2" class="block text-sm font-medium text-gray-700">Teléfono 2</label><input type="tel" id="edit-client-phone2" class="w-full p-2 border border-gray-300 rounded-lg mt-1" value="${client.telefono2 || ''}"></div><div><label for="edit-client-nit" class="block text-sm font-medium text-gray-700">NIT</label><input type="text" id="edit-client-nit" class="w-full p-2 border border-gray-300 rounded-lg mt-1" value="${client.nit || ''}"></div><div class="flex gap-4 justify-end pt-4"><button type="button" id="cancel-edit-btn" class="bg-gray-200 text-gray-700 px-4 py-2 rounded-lg font-semibold">Cancelar</button><button type="submit" class="bg-indigo-600 text-white px-4 py-2 rounded-lg font-semibold">Guardar Cambios</button></div></form></div>`; document.getElementById('modal').classList.remove('hidden'); document.getElementById('cancel-edit-btn').addEventListener('click', hideModal); document.getElementById('edit-client-form').addEventListener('submit', async (e) => { e.preventDefault(); const clientId = document.getElementById('edit-client-id').value; const updatedData = { nombre: document.getElementById('edit-client-name').value, email: document.getElementById('edit-client-email').value, telefono1: document.getElementById('edit-client-phone1').value, telefono2: document.getElementById('edit-client-phone2').value, nit: document.getElementById('edit-client-nit').value, }; showModalMessage("Actualizando cliente...", true); try { await updateDoc(doc(db, "clientes", clientId), updatedData); hideModal(); showModalMessage("¡Cliente actualizado!", false, 2000); } catch (error) { console.error("Error al actualizar cliente:", error); showModalMessage("Error al actualizar."); } }); }
function showEditProviderModal(provider) { const modalContentWrapper = document.getElementById('modal-content-wrapper'); modalContentWrapper.innerHTML = `<div class="bg-white rounded-lg p-6 shadow-xl max-w-sm w-full mx-auto text-center"><h2 class="text-xl font-semibold mb-4">Editar Proveedor</h2><form id="edit-provider-form" class="space-y-4 text-left"><input type="hidden" id="edit-provider-id" value="${provider.id}"><div><label for="edit-provider-name" class="block text-sm font-medium text-gray-700">Nombre</label><input type="text" id="edit-provider-name" class="w-full p-2 border border-gray-300 rounded-lg mt-1" value="${provider.nombre}" required></div><div><label for="edit-provider-contact" class="block text-sm font-medium text-gray-700">Contacto</label><input type="text" id="edit-provider-contact" class="w-full p-2 border border-gray-300 rounded-lg mt-1" value="${provider.contacto || ''}"></div><div><label for="edit-provider-phone" class="block text-sm font-medium text-gray-700">Teléfono</label><input type="tel" id="edit-provider-phone" class="w-full p-2 border border-gray-300 rounded-lg mt-1" value="${provider.telefono || ''}"></div><div><label for="edit-provider-email" class="block text-sm font-medium text-gray-700">Correo</label><input type="email" id="edit-provider-email" class="w-full p-2 border border-gray-300 rounded-lg mt-1" value="${provider.email || ''}"></div><div class="flex gap-4 justify-end pt-4"><button type="button" id="cancel-edit-btn" class="bg-gray-200 text-gray-700 px-4 py-2 rounded-lg font-semibold">Cancelar</button><button type="submit" class="bg-indigo-600 text-white px-4 py-2 rounded-lg font-semibold">Guardar Cambios</button></div></form></div>`; document.getElementById('modal').classList.remove('hidden'); document.getElementById('cancel-edit-btn').addEventListener('click', hideModal); document.getElementById('edit-provider-form').addEventListener('submit', async (e) => { e.preventDefault(); const providerId = document.getElementById('edit-provider-id').value; const updatedData = { nombre: document.getElementById('edit-provider-name').value, contacto: document.getElementById('edit-provider-contact').value, telefono: document.getElementById('edit-provider-phone').value, email: document.getElementById('edit-provider-email').value, }; showModalMessage("Actualizando proveedor...", true); try { await updateDoc(doc(db, "proveedores", providerId), updatedData); hideModal(); showModalMessage("¡Proveedor actualizado!", false, 2000); } catch (error) { console.error("Error al actualizar proveedor:", error); showModalMessage("Error al actualizar."); } }); }
function showPdfModal(pdfUrl, title) { const modalContentWrapper = document.getElementById('modal-content-wrapper'); modalContentWrapper.innerHTML = `<div class="bg-white rounded-lg shadow-xl w-full max-w-6xl mx-auto flex flex-col" style="height: 80vh;"><div class="flex justify-between items-center p-4 border-b"><h2 class="text-xl font-semibold">Visor: ${title}</h2><button id="close-pdf-modal" class="text-gray-500 hover:text-gray-800 text-3xl">&times;</button></div><div class="flex-grow p-2 bg-gray-200"><iframe id="pdf-iframe" src="${pdfUrl}" class="w-full h-full" frameborder="0" allow="fullscreen"></iframe></div></div>`; document.getElementById('modal').classList.remove('hidden'); document.getElementById('close-pdf-modal').addEventListener('click', hideModal); }
function showPaymentModal(remision) {
    const modalContentWrapper = document.getElementById('modal-content-wrapper');
    const totalConfirmado = (remision.payments || []).filter(p => p.status === 'confirmado').reduce((sum, p) => sum + p.amount, 0);
    const totalPorConfirmar = (remision.payments || []).filter(p => p.status === 'por confirmar').reduce((sum, p) => sum + p.amount, 0);
    const saldoPendiente = remision.valorTotal - totalConfirmado;
    const saldoRealPendiente = remision.valorTotal - totalConfirmado - totalPorConfirmar;

    const paymentsHTML = (remision.payments || []).map((p, index) => {
        let statusBadge = '';
        let confirmButton = '';
        if (p.status === 'por confirmar') {
            statusBadge = `<span class="text-xs font-semibold bg-yellow-200 text-yellow-800 px-2 py-1 rounded-full">Por Confirmar</span>`;
            if (currentUserData.role === 'admin' && p.registeredBy !== currentUser.uid) {
                confirmButton = `<button data-remision-id="${remision.id}" data-payment-index="${index}" class="confirm-payment-btn bg-green-500 text-white text-xs px-2 py-1 rounded hover:bg-green-600">Confirmar</button>`;
            }
        } else {
            statusBadge = `<span class="text-xs font-semibold bg-green-200 text-green-800 px-2 py-1 rounded-full">Confirmado</span>`;
        }

        return `<tr class="border-b">
            <td class="p-2">${p.date}</td>
            <td class="p-2">${p.method}</td>
            <td class="p-2 text-right">${formatCurrency(p.amount)}</td>
            <td class="p-2">${statusBadge}</td>
            <td class="p-2">${confirmButton}</td>
        </tr>`;
    }).join('');

    modalContentWrapper.innerHTML = `<div class="bg-white rounded-lg p-6 shadow-xl max-w-3xl w-full mx-auto text-left"><div class="flex justify-between items-center mb-4"><h2 class="text-xl font-semibold">Gestionar Pagos (Remisión N° ${remision.numeroRemision})</h2><button id="close-payment-modal" class="text-gray-500 hover:text-gray-800 text-3xl">&times;</button></div><div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4 text-center"><div class="bg-blue-50 p-3 rounded-lg"><div class="text-sm text-blue-800">VALOR TOTAL</div><div class="font-bold text-lg">${formatCurrency(remision.valorTotal)}</div></div><div class="bg-green-50 p-3 rounded-lg"><div class="text-sm text-green-800">PAGADO (CONF.)</div><div class="font-bold text-lg">${formatCurrency(totalConfirmado)}</div></div><div class="bg-yellow-50 p-3 rounded-lg"><div class="text-sm text-yellow-800">POR CONFIRMAR</div><div class="font-bold text-lg">${formatCurrency(totalPorConfirmar)}</div></div><div class="bg-red-50 p-3 rounded-lg"><div class="text-sm text-red-800">SALDO PENDIENTE</div><div class="font-bold text-lg">${formatCurrency(saldoPendiente)}</div></div></div><div class="grid grid-cols-1 md:grid-cols-2 gap-6"><div><h3 class="font-semibold mb-2">Historial de Pagos</h3><div class="border rounded-lg max-h-60 overflow-y-auto"><table class="w-full text-sm"><thead class="bg-gray-50"><tr><th class="p-2 text-left">Fecha</th><th class="p-2 text-left">Método</th><th class="p-2 text-right">Monto</th><th class="p-2 text-left">Estado</th><th></th></tr></thead><tbody>${paymentsHTML || '<tr><td colspan="5" class="p-4 text-center text-gray-500">No hay pagos registrados.</td></tr>'}</tbody></table></div></div><div><h3 class="font-semibold mb-2">Registrar Nuevo Pago</h3>${saldoRealPendiente > 0 ? `<form id="add-payment-form" class="space-y-3 bg-gray-50 p-4 rounded-lg"><div><label for="new-payment-amount" class="text-sm font-medium">Monto del Abono</label><input type="text" inputmode="numeric" id="new-payment-amount" class="w-full p-2 border rounded-md mt-1" max="${saldoRealPendiente}" required></div><div><label for="new-payment-date" class="text-sm font-medium">Fecha del Pago</label><input type="date" id="new-payment-date" class="w-full p-2 border rounded-md mt-1" value="${new Date().toISOString().split('T')[0]}" required></div><div><label for="new-payment-method" class="text-sm font-medium">Método de Pago</label><select id="new-payment-method" class="w-full p-2 border rounded-md mt-1 bg-white" required><option value="Efectivo">Efectivo</option><option value="Nequi">Nequi</option><option value="Davivienda">Davivienda</option></select></div><button type="submit" class="w-full bg-indigo-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-indigo-700">Registrar Pago</button></form>` : '<div class="bg-green-100 text-green-800 p-4 rounded-lg text-center font-semibold">Esta remisión ya ha sido pagada en su totalidad.</div>'}</div></div></div>`;
    document.getElementById('modal').classList.remove('hidden');
    document.getElementById('close-payment-modal').addEventListener('click', hideModal);

    document.querySelectorAll('.confirm-payment-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const remisionId = e.currentTarget.dataset.remisionId;
            const paymentIndex = parseInt(e.currentTarget.dataset.paymentIndex);
            const remisionToUpdate = allRemisiones.find(r => r.id === remisionId);
            if (remisionToUpdate && remisionToUpdate.payments[paymentIndex]) {
                remisionToUpdate.payments[paymentIndex].status = 'confirmado';
                remisionToUpdate.payments[paymentIndex].confirmedBy = currentUser.uid;
                remisionToUpdate.payments[paymentIndex].confirmedAt = new Date();
                showModalMessage("Confirmando pago...", true);
                try {
                    await updateDoc(doc(db, "remisiones", remisionId), { payments: remisionToUpdate.payments });
                    hideModal();
                    showModalMessage("¡Pago confirmado!", false, 1500);
                } catch (error) {
                    console.error("Error al confirmar pago:", error);
                    showModalMessage("Error al confirmar el pago.");
                }
            }
        });
    });

    if (saldoRealPendiente > 0) {
        const paymentAmountInput = document.getElementById('new-payment-amount');
        paymentAmountInput.addEventListener('focus', (e) => unformatCurrencyInput(e.target));
        paymentAmountInput.addEventListener('blur', (e) => formatCurrencyInput(e.target));
        document.getElementById('add-payment-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const amount = unformatCurrency(paymentAmountInput.value);
            if (amount <= 0 || !amount) { showModalMessage("El monto debe ser mayor a cero."); return; }
            if (amount > saldoRealPendiente + 0.01) {
                showModalMessage(`El monto del pago no puede superar el saldo pendiente de ${formatCurrency(saldoRealPendiente)}.`);
                return;
            }

            const newPayment = {
                amount: amount,
                date: document.getElementById('new-payment-date').value,
                method: document.getElementById('new-payment-method').value,
                registeredAt: new Date(),
                registeredBy: currentUser.uid,
                status: 'por confirmar'
            };
            showModalMessage("Registrando pago...", true);
            try {
                await updateDoc(doc(db, "remisiones", remision.id), { payments: arrayUnion(newPayment) });
                hideModal();
                showModalMessage("¡Pago registrado! Pendiente de confirmación.", false, 2000);
            } catch (error) {
                console.error("Error al registrar pago:", error);
                showModalMessage("Error al registrar el pago.");
            }
        });
    }
}

function showDashboardModal() {
    const modalContentWrapper = document.getElementById('modal-content-wrapper');

    modalContentWrapper.innerHTML = `
            <div class="bg-white rounded-lg shadow-xl w-full max-w-6xl mx-auto text-left flex flex-col" style="height: 80vh;">
                <div class="flex justify-between items-center p-4 border-b">
                    <h2 class="text-xl font-semibold">Resumen Financiero</h2>
                    <div class="flex items-center gap-4">
                        <button id="download-report-btn" class="bg-blue-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-blue-700">Descargar Reporte PDF</button>
                        <button id="close-dashboard-modal" class="text-gray-500 hover:text-gray-800 text-3xl">&times;</button>
                    </div>
                </div>
                <div class="border-b border-gray-200">
                    <nav class="-mb-px flex space-x-6 px-6">
                        <button id="dashboard-tab-summary" class="dashboard-tab-btn active py-4 px-1 font-semibold">Resumen Mensual</button>
                        <button id="dashboard-tab-cartera" class="dashboard-tab-btn py-4 px-1 font-semibold">Cartera</button>
                        <button id="dashboard-tab-clientes" class="dashboard-tab-btn py-4 px-1 font-semibold">Clientes</button>
                    </nav>
                </div>
                <div id="dashboard-summary-view" class="p-6 space-y-6 overflow-y-auto flex-grow"> <div class="flex items-center gap-4"><select id="summary-month" class="p-2 border rounded-lg"></select><select id="summary-year" class="p-2 border rounded-lg"></select></div><div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"><div class="bg-green-100 p-4 rounded-lg"><div class="text-sm font-semibold text-green-800">VENTAS</div><div id="summary-sales" class="text-2xl font-bold"></div></div><div class="bg-red-100 p-4 rounded-lg"><div class="text-sm font-semibold text-red-800">GASTOS</div><div id="summary-expenses" class="text-2xl font-bold"></div></div><div class="bg-indigo-100 p-4 rounded-lg"><div class="text-sm font-semibold text-indigo-800">UTILIDAD/PÉRDIDA</div><div id="summary-profit" class="text-2xl font-bold"></div></div><div class="bg-yellow-100 p-4 rounded-lg"><div class="text-sm font-semibold text-yellow-800">CARTERA PENDIENTE (MES)</div><div id="summary-cartera" class="text-2xl font-bold"></div></div></div><div><h3 class="font-semibold mb-2">Saldos Estimados (Total)</h3><div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"><div class="bg-gray-100 p-4 rounded-lg"><div class="text-sm font-semibold text-gray-800">EFECTIVO</div><div id="summary-efectivo" class="text-xl font-bold"></div></div><div class="bg-gray-100 p-4 rounded-lg"><div class="text-sm font-semibold text-gray-800">NEQUI</div><div id="summary-nequi" class="text-xl font-bold"></div></div><div class="bg-gray-100 p-4 rounded-lg"><div class="text-sm font-semibold text-gray-800">DAVIVIENDA</div><div id="summary-davivienda" class="text-xl font-bold"></div></div><div class="bg-gray-100 p-4 rounded-lg"><div class="text-sm font-semibold text-gray-800">CARTERA TOTAL</div><div id="summary-cartera-total" class="text-xl font-bold"></div></div></div></div><div><h3 class="font-semibold mb-2">Utilidad/Pérdida (Últimos 6 Meses)</h3><div class="bg-gray-50 p-4 rounded-lg"><canvas id="profitLossChart"></canvas></div></div></div>
                <div id="dashboard-cartera-view" class="p-6 hidden flex-grow overflow-y-auto"><h3 class="font-semibold mb-2 text-xl">Cartera Pendiente de Cobro</h3><div id="cartera-list" class="space-y-4"></div><div id="cartera-total" class="text-right font-bold text-xl mt-4"></div></div>
                <div id="dashboard-clientes-view" class="p-6 hidden flex-grow overflow-y-auto">
                    <h3 class="font-semibold mb-2 text-xl">Ranking de Clientes</h3>
                    <div class="flex flex-wrap items-center gap-4 mb-4 p-2 bg-gray-50 rounded-lg">
                        <div class="flex items-center gap-2">
                            <label class="text-sm font-medium">Desde:</label>
                            <select id="rank-start-month" class="p-2 border rounded-lg"></select>
                            <select id="rank-start-year" class="p-2 border rounded-lg"></select>
                        </div>
                        <div class="flex items-center gap-2">
                            <label class="text-sm font-medium">Hasta:</label>
                            <select id="rank-end-month" class="p-2 border rounded-lg"></select>
                            <select id="rank-end-year" class="p-2 border rounded-lg"></select>
                        </div>
                        <button id="rank-filter-btn" class="bg-blue-600 text-white font-semibold py-2 px-4 rounded-lg hover:bg-blue-700">Filtrar</button>
                        <button id="rank-show-all-btn" class="bg-gray-600 text-white font-semibold py-2 px-4 rounded-lg hover:bg-gray-700">Mostrar Todos</button>
                    </div>
                    <div id="top-clientes-list" class="space-y-3"></div>
                </div>
            </div>
        `;
    document.getElementById('modal').classList.remove('hidden');
    document.getElementById('close-dashboard-modal').addEventListener('click', hideModal);

    const monthSelect = document.getElementById('summary-month');
    const yearSelect = document.getElementById('summary-year');
    const rankStartMonth = document.getElementById('rank-start-month');
    const rankStartYear = document.getElementById('rank-start-year');
    const rankEndMonth = document.getElementById('rank-end-month');
    const rankEndYear = document.getElementById('rank-end-year');

    const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
    const now = new Date();

    [monthSelect, rankStartMonth, rankEndMonth].forEach(sel => {
        for (let i = 0; i < 12; i++) { const option = document.createElement('option'); option.value = i; option.textContent = monthNames[i]; if (i === now.getMonth()) option.selected = true; sel.appendChild(option); }
    });
    [yearSelect, rankStartYear, rankEndYear].forEach(sel => {
        for (let i = 0; i < 5; i++) { const year = now.getFullYear() - i; const option = document.createElement('option'); option.value = year; option.textContent = year; sel.appendChild(option); }
    });

    const updateDashboardView = () => updateDashboard(parseInt(yearSelect.value), parseInt(monthSelect.value));
    monthSelect.addEventListener('change', updateDashboardView);
    yearSelect.addEventListener('change', updateDashboardView);

    document.getElementById('rank-filter-btn').addEventListener('click', () => {
        const startDate = new Date(rankStartYear.value, rankStartMonth.value, 1);
        const endDate = new Date(rankEndYear.value, parseInt(rankEndMonth.value) + 1, 0);
        renderTopClientes(startDate, endDate);
    });
    document.getElementById('rank-show-all-btn').addEventListener('click', () => renderTopClientes());


    const summaryTab = document.getElementById('dashboard-tab-summary');
    const carteraTab = document.getElementById('dashboard-tab-cartera');
    const clientesTab = document.getElementById('dashboard-tab-clientes');
    const summaryView = document.getElementById('dashboard-summary-view');
    const carteraView = document.getElementById('dashboard-cartera-view');
    const clientesView = document.getElementById('dashboard-clientes-view');

    summaryTab.addEventListener('click', () => {
        summaryTab.classList.add('active');
        carteraTab.classList.remove('active');
        clientesTab.classList.remove('active');
        summaryView.classList.remove('hidden');
        carteraView.classList.add('hidden');
        clientesView.classList.add('hidden');
    });
    carteraTab.addEventListener('click', () => {
        carteraTab.classList.add('active');
        summaryTab.classList.remove('active');
        clientesTab.classList.remove('active');
        carteraView.classList.remove('hidden');
        summaryView.classList.add('hidden');
        clientesView.classList.add('hidden');
    });
    clientesTab.addEventListener('click', () => {
        clientesTab.classList.add('active');
        summaryTab.classList.remove('active');
        carteraTab.classList.remove('active');
        clientesView.classList.remove('hidden');
        summaryView.classList.add('hidden');
        carteraView.classList.add('hidden');
    });

    document.getElementById('download-report-btn').addEventListener('click', showReportDateRangeModal);

    updateDashboardView();
    renderCartera();
    renderTopClientes();
}
function updateDashboard(year, month) { const salesThisMonth = allRemisiones.flatMap(r => r.payments || []).filter(p => { const d = new Date(p.date); return d.getMonth() === month && d.getFullYear() === year; }).reduce((sum, p) => sum + p.amount, 0); const expensesThisMonth = allGastos.filter(g => { const d = new Date(g.fecha); return d.getMonth() === month && d.getFullYear() === year; }).reduce((sum, g) => sum + g.valorTotal, 0); document.getElementById('summary-sales').textContent = formatCurrency(salesThisMonth); document.getElementById('summary-expenses').textContent = formatCurrency(expensesThisMonth); document.getElementById('summary-profit').textContent = formatCurrency(salesThisMonth - expensesThisMonth); const carteraThisMonth = allRemisiones.filter(r => { const d = new Date(r.fechaRecibido); return d.getMonth() === month && d.getFullYear() === year && r.estado !== 'Anulada'; }).reduce((sum, r) => { const totalPagado = (r.payments || []).reduce((s, p) => s + p.amount, 0); const saldo = r.valorTotal - totalPagado; return sum + (saldo > 0 ? saldo : 0); }, 0); document.getElementById('summary-cartera').textContent = formatCurrency(carteraThisMonth); const totalCartera = allRemisiones.filter(r => r.estado !== 'Anulada').reduce((sum, r) => { const totalPagado = (r.payments || []).reduce((s, p) => s + p.amount, 0); const saldo = r.valorTotal - totalPagado; return sum + (saldo > 0 ? saldo : 0); }, 0); document.getElementById('summary-cartera-total').textContent = formatCurrency(totalCartera); const accountBalances = { Efectivo: 0, Nequi: 0, Davivienda: 0 }; allRemisiones.forEach(r => (r.payments || []).forEach(p => { if (accountBalances[p.method] !== undefined) accountBalances[p.method] += p.amount; })); allGastos.forEach(g => { if (accountBalances[g.fuentePago] !== undefined) accountBalances[g.fuentePago] -= g.valorTotal; }); document.getElementById('summary-efectivo').textContent = formatCurrency(accountBalances.Efectivo); document.getElementById('summary-nequi').textContent = formatCurrency(accountBalances.Nequi); document.getElementById('summary-davivienda').textContent = formatCurrency(accountBalances.Davivienda); const monthNames = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]; const labels = []; const salesData = []; const expensesData = []; for (let i = 5; i >= 0; i--) { const d = new Date(); d.setMonth(d.getMonth() - i); const m = d.getMonth(); const y = d.getFullYear(); labels.push(monthNames[m]); const monthlySales = allRemisiones.flatMap(r => r.payments || []).filter(p => { const pDate = new Date(p.date); return pDate.getMonth() === m && pDate.getFullYear() === y; }).reduce((sum, p) => sum + p.amount, 0); const monthlyExpenses = allGastos.filter(g => { const gDate = new Date(g.fecha); return gDate.getMonth() === m && gDate.getFullYear() === y; }).reduce((sum, g) => sum + g.valorTotal, 0); salesData.push(monthlySales); expensesData.push(monthlyExpenses); } const ctx = document.getElementById('profitLossChart').getContext('2d'); if (profitLossChart) { profitLossChart.destroy(); } profitLossChart = new Chart(ctx, { type: 'bar', data: { labels, datasets: [{ label: 'Ventas', data: salesData, backgroundColor: 'rgba(75, 192, 192, 0.6)' }, { label: 'Gastos', data: expensesData, backgroundColor: 'rgba(255, 99, 132, 0.6)' }] }, options: { scales: { y: { beginAtZero: true } } } }); }

function calculateOverdueDays(dateString) {
    const today = new Date();
    const receivedDate = new Date(dateString);
    today.setHours(0, 0, 0, 0);
    receivedDate.setHours(0, 0, 0, 0);
    const diffTime = today - receivedDate;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays > 0 ? diffDays : 0;
}

function renderCartera() {
    const carteraListEl = document.getElementById('cartera-list');
    const carteraTotalEl = document.getElementById('cartera-total');
    const pendingRemisiones = allRemisiones.filter(r => {
        if (r.estado === 'Anulada') return false;
        const totalPagado = (r.payments || []).reduce((sum, p) => sum + p.amount, 0);
        return r.valorTotal - totalPagado > 0.01;
    }).sort((a, b) => new Date(a.fechaRecibido) - new Date(b.fechaRecibido));

    carteraListEl.innerHTML = ''; // Clear previous content

    if (pendingRemisiones.length === 0) {
        carteraListEl.innerHTML = '<p class="text-center text-gray-500 py-8">¡No hay cartera pendiente!</p>';
        carteraTotalEl.innerHTML = '';
        return;
    }

    let totalCartera = 0;
    pendingRemisiones.forEach(r => {
        const totalPagado = (r.payments || []).reduce((sum, p) => sum + p.amount, 0);
        const saldoPendiente = r.valorTotal - totalPagado;
        totalCartera += saldoPendiente;
        const overdueDays = calculateOverdueDays(r.fechaRecibido);
        let overdueColor = 'text-gray-600';
        if (overdueDays > 30) overdueColor = 'text-yellow-600';
        if (overdueDays > 60) overdueColor = 'text-red-600';

        const card = document.createElement('div');
        card.className = 'bg-white p-4 rounded-lg shadow-md border border-gray-200';
        card.innerHTML = `
                <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center">
                    <div class="mb-2 sm:mb-0">
                        <p class="font-bold text-gray-800">${r.clienteNombre}</p>
                        <p class="text-sm text-gray-500">Remisión N° <span class="font-mono">${r.numeroRemision}</span> &bull; Recibido: ${r.fechaRecibido}</p>
                    </div>
                    <div class="text-left sm:text-right w-full sm:w-auto">
                        <p class="text-sm text-gray-500">Saldo Pendiente</p>
                        <p class="font-bold text-xl text-red-600">${formatCurrency(saldoPendiente)}</p>
                    </div>
                </div>
                <div class="mt-2 pt-2 border-t border-gray-200 text-sm flex justify-between items-center">
                    <p><span class="font-semibold">Valor Total:</span> ${formatCurrency(r.valorTotal)}</p>
                    <p class="${overdueColor} font-semibold">${overdueDays} días de vencido</p>
                </div>
            `;
        carteraListEl.appendChild(card);
    });

    carteraTotalEl.innerHTML = `Total Cartera: <span class="text-red-600">${formatCurrency(totalCartera)}</span>`;
}
function renderTopClientes(startDate, endDate) {
    const container = document.getElementById('top-clientes-list');
    if (!container) return;

    let remisionesToAnalyze = allRemisiones;
    if (startDate && endDate) {
        remisionesToAnalyze = allRemisiones.filter(r => {
            const d = new Date(r.fechaRecibido);
            return d >= startDate && d <= endDate;
        });
    }

    const clientesConHistorial = allClientes.map(cliente => {
        const remisionesCliente = remisionesToAnalyze.filter(r => r.idCliente === cliente.id && r.estado !== 'Anulada');
        const totalComprado = remisionesCliente.reduce((sum, r) => sum + r.valorTotal, 0);
        return { ...cliente, totalComprado, numCompras: remisionesCliente.length };
    }).filter(c => c.numCompras > 0)
        .sort((a, b) => b.totalComprado - a.totalComprado);

    container.innerHTML = '';
    if (clientesConHistorial.length === 0) {
        container.innerHTML = '<p class="text-center text-gray-500 py-8">No hay datos de compras de clientes para el rango seleccionado.</p>';
        return;
    }

    clientesConHistorial.forEach(cliente => {
        const el = document.createElement('div');
        el.className = 'border p-4 rounded-lg';
        el.innerHTML = `
                <div class="flex justify-between items-center">
                    <p class="font-semibold text-lg">${cliente.nombre}</p>
                    <p class="font-bold text-xl text-green-600">${formatCurrency(cliente.totalComprado)}</p>
                </div>
                <p class="text-sm text-gray-600">${cliente.numCompras} ${cliente.numCompras === 1 ? 'compra' : 'compras'}</p>
            `;
        container.appendChild(el);
    });
}
const modal = document.getElementById('modal');
let modalTimeout;
function showModalMessage(message, isLoader = false, duration = 0) {
    const modalContentWrapper = document.getElementById('modal-content-wrapper');
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
function formatCurrency(value) { return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(value); }
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
function generateSummaryPDF(startYear, startMonth, endYear, endMonth) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
    const startDate = new Date(startYear, startMonth, 1);
    const endDate = new Date(endYear, endMonth + 1, 0);

    const rangeTitle = `${monthNames[startMonth]} ${startYear} - ${monthNames[endMonth]} ${endYear}`;
    doc.setFontSize(20);
    doc.text(`Reporte Financiero: ${rangeTitle}`, 105, 20, { align: "center" });

    // Calculate totals for the entire period
    const salesInRange = allRemisiones.flatMap(r => r.payments || []).filter(p => { const d = new Date(p.date); return d >= startDate && d <= endDate; }).reduce((sum, p) => sum + p.amount, 0);
    const expensesInRange = allGastos.filter(g => { const d = new Date(g.fecha); return d >= startDate && d <= endDate; }).reduce((sum, g) => sum + g.valorTotal, 0);
    const profitInRange = salesInRange - expensesInRange;

    const summaryData = [
        ['Ventas Totales en el Período', formatCurrency(salesInRange)],
        ['Gastos Totales en el Período', formatCurrency(expensesInRange)],
        ['Utilidad/Pérdida Total', formatCurrency(profitInRange)],
    ];

    doc.autoTable({
        startY: 30,
        head: [['Resumen del Período', 'Valor']],
        body: summaryData,
        theme: 'grid',
        headStyles: { fillColor: [41, 128, 185] }
    });

    // Monthly breakdown
    const monthlyData = [];
    let currentDate = new Date(startDate);
    while (currentDate <= endDate) {
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth();
        const monthName = monthNames[month];

        const monthlySales = allRemisiones.flatMap(r => r.payments || []).filter(p => { const d = new Date(p.date); return d.getMonth() === month && d.getFullYear() === year; }).reduce((sum, p) => sum + p.amount, 0);
        const monthlyExpenses = allGastos.filter(g => { const d = new Date(g.fecha); return d.getMonth() === month && d.getFullYear() === year; }).reduce((sum, g) => sum + g.valorTotal, 0);
        const monthlyProfit = monthlySales - monthlyExpenses;
        const endOfMonth = new Date(year, month + 1, 0);
        const carteraAtEndOfMonth = allRemisiones.filter(r => new Date(r.fechaRecibido) <= endOfMonth && r.estado !== 'Anulada').reduce((sum, r) => { const totalPagado = (r.payments || []).filter(p => new Date(p.date) <= endOfMonth).reduce((s, p) => s + p.amount, 0); const saldo = r.valorTotal - totalPagado; return sum + (saldo > 0 ? saldo : 0); }, 0);


        monthlyData.push([
            `${monthName} ${year}`,
            formatCurrency(monthlySales),
            formatCurrency(monthlyExpenses),
            formatCurrency(monthlyProfit),
            formatCurrency(carteraAtEndOfMonth)
        ]);
        currentDate.setMonth(currentDate.getMonth() + 1);
    }

    doc.autoTable({
        startY: doc.lastAutoTable.finalY + 10,
        head: [['Mes', 'Ventas', 'Gastos', 'Utilidad/Pérdida', 'Cartera al Cierre']],
        body: monthlyData,
        theme: 'striped',
        headStyles: { fillColor: [22, 160, 133] }
    });

    const accountBalances = { Efectivo: 0, Nequi: 0, Davivienda: 0 };
    allRemisiones.forEach(r => (r.payments || []).forEach(p => { if (accountBalances[p.method] !== undefined) accountBalances[p.method] += p.amount; }));
    allGastos.forEach(g => { if (accountBalances[g.fuentePago] !== undefined) accountBalances[g.fuentePago] -= g.valorTotal; });
    const totalCartera = allRemisiones.filter(r => r.estado !== 'Anulada').reduce((sum, r) => { const totalPagado = (r.payments || []).reduce((s, p) => s + p.amount, 0); const saldo = r.valorTotal - totalPagado; return sum + (saldo > 0 ? saldo : 0); }, 0);

    const accountData = [
        ['Efectivo', formatCurrency(accountBalances.Efectivo)],
        ['Nequi', formatCurrency(accountBalances.Nequi)],
        ['Davivienda', formatCurrency(accountBalances.Davivienda)],
        ['Cartera Total Pendiente', formatCurrency(totalCartera)],
    ];

    doc.autoTable({
        startY: doc.lastAutoTable.finalY + 10,
        head: [['Saldos y Totales Actuales', 'Valor']],
        body: accountData,
        theme: 'grid',
        headStyles: { fillColor: [41, 128, 185] }
    });

    doc.save(`Reporte-Financiero-${startYear}-${startMonth + 1}_a_${endYear}-${endMonth + 1}.pdf`);
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
            <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div class="md:col-span-1 space-y-4">
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
                <div class="md:col-span-2">
                    <h3 class="text-lg font-semibold mb-2">Historial de Pagos</h3>
                    <div class="border rounded-lg max-h-96 overflow-y-auto">
                        <table class="w-full text-sm">
                            <thead class="bg-gray-100"><tr><th class="p-2 text-left">Fecha</th><th class="p-2 text-left">Motivo</th><th class="p-2 text-right">Valor</th><th class="p-2 text-left">Fuente</th></tr></thead>
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
    const maxDiscount = remision.subtotal * 0.05;

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
                        <p class="text-xs text-gray-500 mt-1">Máximo descuento permitido: <span class="font-semibold">${formatCurrency(maxDiscount)}</span> (5%)</p>
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
        if (discountAmount > maxDiscount) {
            showModalMessage(`El descuento no puede superar el 5% (${formatCurrency(maxDiscount)}).`);
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