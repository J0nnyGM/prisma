import { auth } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { handleAuthStateChange, setupAuthEventListeners } from './auth.js';
import { injectHTMLTemplates, setupUIEventListeners, populateDateFilters, updateUIVisibility } from './ui.js';
import { loadRemisiones, setupRemisionesEventListeners } from './remisiones.js';
import { setupFacturacionEventListeners, loadFacturacion } from './facturacion.js';
import { loadClientes, setupClientesEventListeners } from './clientes.js';
import { loadItems, setupItemsEventListeners } from './items.js';
import { loadColores, setupColoresEventListeners } from './colores.js';
import { loadGastos, setupGastosEventListeners } from './gastos.js';
import { loadProveedores, setupProveedoresEventListeners } from './proveedores.js';
import { loadEmpleados, setupEmpleadoEventListeners } from './empleados.js';

// --- Estado Global ---
export let currentUser = null;
export let currentUserData = null;
export let allItems = [];
export let allColores = [];
export let allClientes = [];
export let allProveedores = [];
export let allGastos = [];
export let allRemisiones = [];

// --- Funciones de Actualización de Estado ---
export const setCurrentUser = (user) => { currentUser = user; };
export const setCurrentUserData = (data) => { currentUserData = data; };
export const setAllItems = (data) => { allItems = data; };
export const setAllColores = (data) => { allColores = data; };
export const setAllClientes = (data) => { allClientes = data; };
export const setAllProveedores = (data) => { allProveedores = data; };
export const setAllGastos = (data) => { allGastos = data; };
export const setAllRemisiones = (data) => { allRemisiones = data; };

// --- Inicialización de la Aplicación ---
document.addEventListener('DOMContentLoaded', () => {
    // 1. Inyectar todo el HTML de las vistas en el DOM
    injectHTMLTemplates();

    // 2. Configurar los listeners de eventos principales
    setupAuthEventListeners();
    setupUIEventListeners();
    
    // 3. Configurar los listeners para cada módulo en el orden del menú
    setupRemisionesEventListeners();
    setupFacturacionEventListeners();
    setupClientesEventListeners();
    setupItemsEventListeners();
    setupColoresEventListeners();
    setupGastosEventListeners();
    setupProveedoresEventListeners();
    setupEmpleadoEventListeners();

    // 4. Poblar los filtros de fecha que ahora están en el DOM
    populateDateFilters('filter-remisiones');
    populateDateFilters('filter-gastos');

    // 5. Escuchar cambios de autenticación para iniciar la app
    onAuthStateChanged(auth, async (user) => {
        const { authUser, userData } = await handleAuthStateChange(user);
        setCurrentUser(authUser);
        setCurrentUserData(userData);

        if (authUser && userData) {
            loadInitialData();
        }
    });
});

// --- Carga de Datos Iniciales ---
function loadInitialData() {
    if (!currentUserData) {
        console.error("loadInitialData called without currentUserData.");
        return;
    }
    
    updateUIVisibility(currentUserData);
    
    // Cargar datos de Firestore en un orden que respete las dependencias
    // Cargar datos base primero
    loadClientes();
    loadItems();
    loadColores();
    loadProveedores();
    
    // Cargar módulos que dependen de los datos base
    loadGastos();     // Depende de proveedores.
    loadRemisiones(); // Depende de clientes, items, colores. Llama a renderFacturacion y renderClientes.
    
    // Cargar módulos finales
    loadFacturacion();
    if (currentUserData.role && currentUserData.role.toLowerCase() === 'admin') {
        loadEmpleados();
    }
}
