// js/modules/dashboard.js

import { db, functions, httpsCallable } from '../firebase-config.js';
import { collection, doc, getDoc, query, onSnapshot, getDocs, where, serverTimestamp, updateDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";
import { 
    allRemisiones, allGastos, allClientes, allUsers, initialBalances, currentUserData, currentUser,
    showModalMessage, hideModal, showTemporaryMessage 
} from '../app.js';
import { formatCurrency, unformatCurrency, unformatCurrencyInput, formatCurrencyInput } from '../utils.js';
import { METODOS_DE_PAGO } from '../constants.js';

export let _unsubscribePendingTransfers = null;

export function cleanupDashboardListeners() {
    if (_unsubscribePendingTransfers) {
        _unsubscribePendingTransfers();
        _unsubscribePendingTransfers = null;
    }
}

// Variables de paginación y filtros para el Resumen Financiero
let currentPageCarteraDetalle = 1;
const carteraDetallePerPage = 10;
let currentPageCarteraCliente = 1;
const carteraClientePerPage = 10;
let currentPageTopClientes = 1;
const topClientesPerPage = 10;
let currentTopClientesStartDate = null;
let currentTopClientesEndDate = null;

// --- OPTIMIZACIÓN 1: SALDOS INICIALES CON CACHÉ ---
const BALANCES_CACHE_KEY = 'initial_balances_cache';

async function ensureInitialBalances() {
    if (Object.keys(initialBalances).length > 0) return; // Ya en memoria RAM

    const cachedData = localStorage.getItem(BALANCES_CACHE_KEY);
    if (cachedData) {
        try {
            Object.assign(initialBalances, JSON.parse(cachedData));
        } catch (e) {
            localStorage.removeItem(BALANCES_CACHE_KEY);
        }
    }

    try {
        const balanceDocRef = doc(db, "configuracion", "saldos_globales");
        const balanceDoc = await getDoc(balanceDocRef);
        if (balanceDoc.exists()) {
            const data = balanceDoc.data();
            Object.assign(initialBalances, data);
            localStorage.setItem(BALANCES_CACHE_KEY, JSON.stringify(data));
        }
    } catch (error) {
        console.warn("No se pudieron cargar los saldos iniciales desde configuracion/saldos_globales (restricciones de permisos o red). Usando valores locales/caché:", error.message || error);
    }
}

// --- RENDERIZADO DEL DASHBOARD PRINCIPAL ---
export async function showDashboardModal() {
    currentPageCarteraDetalle = 1;
    currentPageCarteraCliente = 1;
    currentPageTopClientes = 1;
    currentTopClientesStartDate = null;
    currentTopClientesEndDate = null;

    const modalContentWrapper = document.getElementById('modal-content-wrapper');

    await ensureInitialBalances();
    const hasRealBalances = Object.keys(initialBalances).some(key => METODOS_DE_PAGO.includes(key));
    let initialBalanceButtonHTML = !hasRealBalances ? `<button id="set-initial-balance-btn" class="bg-slate-650 hover:bg-indigo-755 text-white text-xs font-bold py-2 px-3 sm:text-sm sm:py-2 sm:px-4 rounded-xl transition-colors whitespace-nowrap shadow-xs">Saldos Iniciales</button>` : '';

    const saldosHTML = METODOS_DE_PAGO.map(metodo => `
        <div class="bg-slate-50 border border-slate-100 p-3 sm:p-4 rounded-xl shadow-xs">
            <div class="text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-wider">${metodo.toUpperCase()}</div>
            <div id="summary-${metodo.toLowerCase()}" class="text-lg sm:text-xl font-black text-slate-800 mt-1"></div>
        </div>
    `).join('');

    modalContentWrapper.innerHTML = `
    <div class="modal-card max-w-6xl w-full mx-auto" style="height: 85vh; max-height: 85vh;">
        <div class="modal-header-fixed flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
            <div class="flex justify-between items-center w-full md:w-auto">
                <h2 class="text-xl font-bold text-slate-800">Resumen Financiero</h2>
                <button id="close-dashboard-modal" class="text-gray-500 hover:text-gray-800 text-3xl md:hidden">&times;</button>
            </div>
            <div class="flex items-center gap-2 flex-wrap w-full md:w-auto justify-start md:justify-end">
                ${initialBalanceButtonHTML}
                <button id="show-transfer-modal-btn" class="bg-yellow-600 hover:bg-yellow-700 text-white text-xs font-bold py-2 px-3 sm:text-sm sm:py-2 sm:px-4 rounded-xl transition-colors whitespace-nowrap shadow-xs">Transferir Fondos</button>
                <button id="download-report-btn" class="bg-indigo-650 hover:bg-indigo-755 text-white text-xs font-bold py-2 px-3 sm:text-sm sm:py-2 sm:px-4 rounded-xl transition-colors whitespace-nowrap shadow-xs">Descargar PDF</button>
                <button id="close-dashboard-modal-desktop" class="text-gray-500 hover:text-gray-800 text-3xl hidden md:block">&times;</button>
            </div>
        </div>
        <div class="border-b border-gray-200 bg-slate-50/50 flex-shrink-0">
            <nav class="-mb-px flex space-x-6 px-6 overflow-x-auto">
                <button id="dashboard-tab-summary" class="dashboard-tab-btn active py-4 px-1 font-semibold whitespace-nowrap text-sm border-b-2 border-transparent hover:text-slate-700 transition-all duration-150">Resumen Mensual</button>
                <button id="dashboard-tab-cartera" class="dashboard-tab-btn py-4 px-1 font-semibold whitespace-nowrap text-sm border-b-2 border-transparent hover:text-slate-700 transition-all duration-150">Cartera</button>
                <button id="dashboard-tab-clientes" class="dashboard-tab-btn py-4 px-1 font-semibold whitespace-nowrap text-sm border-b-2 border-transparent hover:text-slate-700 transition-all duration-150">Clientes</button>
                <button id="dashboard-tab-transferencias" class="dashboard-tab-btn py-4 px-1 font-semibold whitespace-nowrap text-sm border-b-2 border-transparent hover:text-slate-700 transition-all duration-150">Transferencias</button>
            </nav>
        </div>
        
        <div id="dashboard-summary-view" class="modal-body-scroll p-4 sm:p-6 space-y-6 flex-grow">
             <div class="flex items-center gap-3 w-full sm:w-auto"> 
                <select id="summary-month" class="p-2.5 border border-slate-300 rounded-xl bg-white shadow-xs focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all text-sm flex-1 sm:flex-initial"></select> 
                <select id="summary-year" class="p-2.5 border border-slate-300 rounded-xl bg-white shadow-xs focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all text-sm flex-1 sm:flex-initial"></select> 
             </div>
             <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4"> 
                <div class="bg-emerald-50 border border-emerald-100 p-3.5 sm:p-5 rounded-2xl shadow-xs"><div class="text-[10px] sm:text-xs font-bold text-emerald-800 uppercase tracking-wider">VENTAS</div><div id="summary-sales" class="text-lg sm:text-2xl font-black text-slate-900 mt-1"></div></div> 
                <div class="bg-rose-50 border border-rose-100 p-3.5 sm:p-5 rounded-2xl shadow-xs"><div class="text-[10px] sm:text-xs font-bold text-rose-800 uppercase tracking-wider">GASTOS</div><div id="summary-expenses" class="text-lg sm:text-2xl font-black text-slate-900 mt-1"></div></div> 
                <div class="bg-indigo-50 border border-indigo-100 p-3.5 sm:p-5 rounded-2xl shadow-xs"><div class="text-[10px] sm:text-xs font-bold text-indigo-800 uppercase tracking-wider">UTILIDAD/PÉRDIDA</div><div id="summary-profit" class="text-lg sm:text-2xl font-black text-slate-900 mt-1"></div></div> 
                <div class="bg-amber-50 border border-amber-100 p-3.5 sm:p-5 rounded-2xl shadow-xs"><div class="text-[10px] sm:text-xs font-bold text-amber-800 uppercase tracking-wider">CARTERA PENDIENTE (MES)</div><div id="summary-cartera" class="text-lg sm:text-2xl font-black text-slate-900 mt-1"></div></div> 
             </div>
             <div> 
                <h3 class="font-bold text-slate-800 text-base border-b border-slate-100 pb-2 mb-3">Saldos Estimados (Total Actual)</h3> 
                <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4"> 
                    ${saldosHTML} 
                    <div class="bg-slate-50 border border-slate-100 p-3 sm:p-4 rounded-xl shadow-xs"> 
                        <div class="text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-wider">CARTERA TOTAL</div> 
                        <div id="summary-cartera-total" class="text-lg sm:text-xl font-black text-slate-800 mt-1"></div> 
                    </div> 
                </div> 
             </div>
             <div class="mt-6 border-t border-slate-100 pt-4"> 
                <h3 class="font-bold text-slate-800 text-base mb-3">Dinero Recibido vs. Gastos (Últimos 6 Meses)</h3> 
                <div class="bg-slate-50 border border-slate-100 p-3 sm:p-5 rounded-2xl shadow-xs"><canvas id="profitLossChart" class="max-h-65"></canvas></div> 
             </div>
        </div>

        <div id="dashboard-cartera-view" class="modal-body-scroll p-4 sm:p-6 hidden flex-grow flex-col">
            <h3 class="font-semibold mb-2 text-xl">Cartera Pendiente de Cobro</h3>
            
            <div class="flex space-x-1 bg-slate-100 p-1 rounded-xl mb-4 w-fit border border-slate-200/50">
                <button id="subtab-cartera-detalle" class="px-4 py-2 rounded-lg text-sm font-semibold bg-white shadow text-gray-800 transition-all">Detalle por Remisión</button>
                <button id="subtab-cartera-cliente" class="px-4 py-2 rounded-lg text-sm font-semibold text-gray-500 hover:text-gray-800 transition-all">Total por Cliente</button>
            </div>

            <div id="view-cartera-detalle">
                <div id="cartera-list" class="space-y-4"></div>
                <div id="cartera-detalle-pagination" class="mt-4 pt-4 border-t border-gray-200"></div>
                <div id="cartera-total" class="text-right font-black text-xl text-slate-800 mt-4 bg-slate-50 p-4 rounded-xl border border-slate-100"></div>
            </div>

            <div id="view-cartera-cliente" class="hidden">
                <div id="cartera-clientes-list" class="space-y-4"></div>
                <div id="cartera-cliente-pagination" class="mt-4 pt-4 border-t border-gray-200"></div>
                <div id="cartera-clientes-total" class="text-right font-black text-xl text-slate-800 mt-4 bg-slate-50 p-4 rounded-xl border border-slate-100"></div>
            </div>
        </div>

        <div id="dashboard-clientes-view" class="modal-body-scroll p-4 sm:p-6 hidden flex-grow">
            <h3 class="font-semibold mb-2 text-xl">Ranking de Clientes</h3>
            <div class="bg-slate-50 border border-slate-200/60 p-4 rounded-2xl mb-5 space-y-4 sm:space-y-0 sm:flex sm:flex-wrap sm:items-end sm:gap-4">
                <div class="grid grid-cols-2 gap-3 sm:flex sm:items-center sm:gap-4 flex-grow">
                    <div class="space-y-1">
                        <label class="text-xs font-bold text-slate-500 uppercase tracking-wider">Desde</label>
                        <div class="flex gap-2">
                            <select id="rank-start-month" class="p-2 border border-slate-300 rounded-lg bg-white text-sm w-full"></select>
                            <select id="rank-start-year" class="p-2 border border-slate-300 rounded-lg bg-white text-sm w-full"></select>
                        </div>
                    </div>
                    <div class="space-y-1">
                        <label class="text-xs font-bold text-slate-500 uppercase tracking-wider">Hasta</label>
                        <div class="flex gap-2">
                            <select id="rank-end-month" class="p-2 border border-slate-300 rounded-lg bg-white text-sm w-full"></select>
                            <select id="rank-end-year" class="p-2 border border-slate-300 rounded-lg bg-white text-sm w-full"></select>
                        </div>
                    </div>
                </div>
                <div class="grid grid-cols-2 gap-3 sm:flex sm:gap-2 pt-2 sm:pt-0">
                    <button id="rank-filter-btn" class="bg-indigo-650 hover:bg-indigo-755 text-white font-bold py-2.5 px-4 rounded-xl text-sm transition-colors whitespace-nowrap shadow-xs">Filtrar</button>
                    <button id="rank-show-all-btn" class="bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold py-2.5 px-4 rounded-xl text-sm transition-colors whitespace-nowrap">Mostrar Todos</button>
                </div>
            </div>
            <div id="top-clientes-list" class="space-y-3"></div>
            <div id="top-clientes-pagination" class="mt-4 pt-4 border-t border-gray-200"></div>
        </div>
        
        <div id="dashboard-transferencias-view" class="modal-body-scroll p-4 sm:p-6 hidden flex-grow flex-col">
            <h3 class="font-semibold mb-2 text-xl">Historial de Transferencias Confirmadas</h3>
            <div class="grid grid-cols-2 gap-4 bg-slate-50 border border-slate-200/60 p-4 rounded-2xl my-4">
                <div class="space-y-1"> 
                    <label for="filter-transfer-month" class="text-xs font-bold text-slate-500 uppercase tracking-wider">Mes</label> 
                    <select id="filter-transfer-month" class="p-2 border border-slate-300 rounded-lg bg-white w-full text-sm"></select> 
                </div>
                <div class="space-y-1"> 
                    <label for="filter-transfer-year" class="text-xs font-bold text-slate-500 uppercase tracking-wider">Año</label> 
                    <select id="filter-transfer-year" class="p-2 border border-slate-300 rounded-lg bg-white w-full text-sm"></select> 
                </div>
            </div>
            <div id="transferencias-list" class="space-y-3"></div>
            <div id="transferencias-pagination" class="mt-auto pt-4 border-t border-gray-200"></div>
        </div>

        <div id="pending-transfers-section" class="p-4 sm:p-6 border-t mt-auto bg-amber-50/50 hidden">
            <h3 class="font-bold mb-2 text-base text-amber-850">Transferencias Pendientes de Confirmación</h3>
            <div id="pending-transfers-list" class="space-y-3 max-h-40 overflow-y-auto"></div>
        </div>
    </div>
    `;

    document.getElementById('modal').classList.remove('hidden');

    const tabs = {
        summary: document.getElementById('dashboard-tab-summary'),
        cartera: document.getElementById('dashboard-tab-cartera'),
        clientes: document.getElementById('dashboard-tab-clientes'),
        transferencias: document.getElementById('dashboard-tab-transferencias')
    };
    const views = {
        summary: document.getElementById('dashboard-summary-view'),
        cartera: document.getElementById('dashboard-cartera-view'),
        clientes: document.getElementById('dashboard-clientes-view'),
        transferencias: document.getElementById('dashboard-transferencias-view')
    };

    Object.keys(tabs).forEach(key => {
        if (tabs[key]) {
            tabs[key].addEventListener('click', () => {
                Object.values(tabs).forEach(t => t?.classList.remove('active'));
                Object.values(views).forEach(v => v?.classList.add('hidden'));
                tabs[key].classList.add('active');
                if (views[key]) views[key].classList.remove('hidden');
                
                if (key === 'transferencias') { 
                    currentPageTransfers = 1;
                    loadConfirmedTransfers(); 
                }
            });
        }
    });

    const subTabDetalle = document.getElementById('subtab-cartera-detalle');
    const subTabCliente = document.getElementById('subtab-cartera-cliente');
    const viewDetalle = document.getElementById('view-cartera-detalle');
    const viewCliente = document.getElementById('view-cartera-cliente');

    if (subTabDetalle && subTabCliente) {
        subTabDetalle.addEventListener('click', () => {
            subTabDetalle.classList.add('bg-white', 'shadow', 'text-gray-800');
            subTabDetalle.classList.remove('text-gray-500');
            subTabCliente.classList.remove('bg-white', 'shadow', 'text-gray-800');
            subTabCliente.classList.add('text-gray-500');
            viewDetalle.classList.remove('hidden');
            viewCliente.classList.add('hidden');
            currentPageCarteraDetalle = 1;
            renderCartera();
        });

        subTabCliente.addEventListener('click', () => {
            subTabCliente.classList.add('bg-white', 'shadow', 'text-gray-800');
            subTabCliente.classList.remove('text-gray-500');
            subTabDetalle.classList.remove('bg-white', 'shadow', 'text-gray-800');
            subTabDetalle.classList.add('text-gray-500');
            viewCliente.classList.remove('hidden');
            viewDetalle.classList.add('hidden');
            currentPageCarteraCliente = 1;
            renderCarteraClientes();
        });
    }

    const closeBtnIds = ['close-dashboard-modal', 'close-dashboard-modal-desktop'];
    closeBtnIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('click', () => {
            cleanupDashboardListeners();
            hideModal();
        });
    });

    const initialBalanceBtn = document.getElementById('set-initial-balance-btn');
    if (initialBalanceBtn) initialBalanceBtn.addEventListener('click', showInitialBalanceModal);

    const downloadBtn = document.getElementById('download-report-btn');
    if (downloadBtn) downloadBtn.addEventListener('click', showReportDateRangeModal);
    
    const transferBtn = document.getElementById('show-transfer-modal-btn');
    if (transferBtn) transferBtn.addEventListener('click', showTransferModal);

    populateDateFilters('summary');
    populateDateFilters('rank-start');
    populateDateFilters('rank-end');
    populateDateFilters('filter-transfer');

    const monthSelect = document.getElementById('summary-month');
    const yearSelect = document.getElementById('summary-year');
    const updateDashboardView = () => updateDashboard(parseInt(yearSelect.value), parseInt(monthSelect.value));
    if (monthSelect) monthSelect.addEventListener('change', updateDashboardView);
    if (yearSelect) yearSelect.addEventListener('change', updateDashboardView);

    const rankStartMonth = document.getElementById('rank-start-month');
    const rankStartYear = document.getElementById('rank-start-year');
    const rankEndMonth = document.getElementById('rank-end-month');
    const rankEndYear = document.getElementById('rank-end-year');
    const rankFilterBtn = document.getElementById('rank-filter-btn');
    if (rankFilterBtn) rankFilterBtn.addEventListener('click', () => {
        currentPageTopClientes = 1;
        currentTopClientesStartDate = new Date(rankStartYear.value, rankStartMonth.value, 1);
        currentTopClientesEndDate = new Date(rankEndYear.value, parseInt(rankEndMonth.value) + 1, 0);
        renderTopClientes();
    });
    
    const rankShowAllBtn = document.getElementById('rank-show-all-btn');
    if (rankShowAllBtn) rankShowAllBtn.addEventListener('click', () => {
        currentPageTopClientes = 1;
        currentTopClientesStartDate = null;
        currentTopClientesEndDate = null;
        renderTopClientes();
    });

    const transferMonthFilter = document.getElementById('filter-transfer-month');
    const transferYearFilter = document.getElementById('filter-transfer-year');
    
    const resetAndRenderTransfers = () => {
        currentPageTransfers = 1;
        renderConfirmedTransfersList();
    };

    if (transferMonthFilter) transferMonthFilter.addEventListener('change', resetAndRenderTransfers);
    if (transferYearFilter) transferYearFilter.addEventListener('change', resetAndRenderTransfers);

    renderPendingTransfers();
    updateDashboardView();
    renderCartera();
    renderTopClientes();
}

function populateDateFilters(prefix) {
    const monthSelect = document.getElementById(`${prefix}-month`);
    const yearSelect = document.getElementById(`${prefix}-year`);
    if (!monthSelect || !yearSelect) return;

    const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
    const now = new Date();

    monthSelect.innerHTML = prefix.includes('filter-') || prefix.includes('rank-') ? '<option value="all">Todos los Meses</option>' : '';
    for (let i = 0; i < 12; i++) {
        const option = document.createElement('option');
        option.value = i;
        option.textContent = monthNames[i];
        if (i === now.getMonth() && !prefix.includes('filter-')) option.selected = true;
        monthSelect.appendChild(option);
    }

    yearSelect.innerHTML = prefix.includes('filter-') || prefix.includes('rank-') ? '<option value="all">Todos los Años</option>' : '';
    const currentYear = now.getFullYear();
    for (let i = 0; i < 5; i++) {
        const year = currentYear - i;
        const option = document.createElement('option');
        option.value = year;
        option.textContent = year;
        yearSelect.appendChild(option);
    }
}

async function updateDashboard(year, month) {
    await ensureInitialBalances();
    
    // VENTAS DEL MES (SOLO PAGOS CONFIRMADOS)
    const salesThisMonth = allRemisiones
        .flatMap(r => Array.isArray(r.payments) ? r.payments : [])
        .filter(p => { 
            const d = new Date(p.date + 'T00:00:00'); 
            return d.getMonth() === month && d.getFullYear() === year && p.status === 'confirmado'; 
        })
        .reduce((sum, p) => sum + p.amount, 0);

    const expensesThisMonth = allGastos.filter(g => { const d = new Date(g.fecha + 'T00:00:00'); return d.getMonth() === month && d.getFullYear() === year; }).reduce((sum, g) => sum + g.valorTotal, 0);

    // Fallbacks calculados en memoria (ventas basadas en remisiones y gastos basados en egresos)
    const inMemoryVentas = allRemisiones
        .filter(r => { 
            const d = new Date(r.fechaRecibido + 'T00:00:00'); 
            return d.getMonth() === month && d.getFullYear() === year && r.estado !== 'Anulada'; 
        })
        .reduce((sum, r) => sum + r.valorTotal, 0);

    let docVentas = inMemoryVentas;
    let docGastos = expensesThisMonth;

    // Intentar leer desde la colección "estadisticas_mensuales" (YYYY_MM)
    const docId = `${year}_${(month + 1).toString().padStart(2, '0')}`;
    try {
        const docRef = doc(db, "estadisticas_mensuales", docId);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            const data = docSnap.data();
            if (data.totalVentas !== undefined) docVentas = data.totalVentas;
            if (data.totalGastos !== undefined) docGastos = data.totalGastos;
        }
    } catch (error) {
        console.warn(`Error al cargar estadisticas_mensuales/${docId}:`, error);
    }

    // CARTERA DEL MES (SOLO RESTAR PAGOS CONFIRMADOS)
    const carteraThisMonth = allRemisiones.filter(r => { const d = new Date(r.fechaRecibido + 'T00:00:00'); return d.getMonth() === month && d.getFullYear() === year && r.estado !== 'Anulada'; })
        .reduce((sum, r) => {
            const paymentsArray = Array.isArray(r.payments) ? r.payments : [];
            const totalPagado = paymentsArray.filter(p => p.status === 'confirmado').reduce((s, p) => s + p.amount, 0);
            const saldo = r.valorTotal - totalPagado;
            return sum + (saldo > 0 ? saldo : 0);
        }, 0);

    const salesEl = document.getElementById('summary-sales');
    if (salesEl) salesEl.textContent = formatCurrency(docVentas);

    const expensesEl = document.getElementById('summary-expenses');
    if (expensesEl) expensesEl.textContent = formatCurrency(docGastos);

    const profitEl = document.getElementById('summary-profit');
    if (profitEl) profitEl.textContent = formatCurrency(docVentas - docGastos);

    const carteraEl = document.getElementById('summary-cartera');
    if (carteraEl) carteraEl.textContent = formatCurrency(carteraThisMonth);

    // CARTERA TOTAL HISTÓRICA (SOLO RESTAR PAGOS CONFIRMADOS)
    const totalCartera = allRemisiones.filter(r => r.estado !== 'Anulada')
        .reduce((sum, r) => {
            const paymentsArray = Array.isArray(r.payments) ? r.payments : [];
            const totalPagado = paymentsArray.filter(p => p.status === 'confirmado').reduce((s, p) => s + p.amount, 0);
            const saldo = r.valorTotal - totalPagado;
            return sum + (saldo > 0 ? saldo : 0);
        }, 0);
    
    const totalCarteraEl = document.getElementById('summary-cartera-total');
    if (totalCarteraEl) totalCarteraEl.textContent = formatCurrency(totalCartera);

    // SALDOS DE CUENTAS (SOLO SUMAR PAGOS CONFIRMADOS)
    const accountBalances = {};
    METODOS_DE_PAGO.forEach(metodo => { accountBalances[metodo] = initialBalances[metodo] || 0; });

    allRemisiones.forEach(r => {
        const paymentsArray = Array.isArray(r.payments) ? r.payments : [];
        paymentsArray.forEach(p => {
            if (p.status === 'confirmado' && accountBalances[p.method] !== undefined) {
                accountBalances[p.method] += p.amount;
            }
        });
    });

    allGastos.forEach(g => {
        if (accountBalances[g.fuentePago] !== undefined) accountBalances[g.fuentePago] -= g.valorTotal;
    });

    METODOS_DE_PAGO.forEach(metodo => {
        const element = document.getElementById(`summary-${metodo.toLowerCase()}`);
        if (element) element.textContent = formatCurrency(accountBalances[metodo]);
    });

    const now = new Date();
    const today = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')}`;

    const breakdown = {};
    METODOS_DE_PAGO.forEach(m => breakdown[m] = 0);
    let totalConfirmedToday = 0;

    allRemisiones.forEach(r => {
        if (r.estado === 'Anulada') return;
        const paymentsArray = Array.isArray(r.payments) ? r.payments : [];
        paymentsArray.forEach(p => {
            if (p.date === today && p.status === 'confirmado') {
                if (breakdown[p.method] !== undefined) {
                    breakdown[p.method] += p.amount;
                    totalConfirmedToday += p.amount;
                }
            }
        });
    });

    const todayRemisiones = allRemisiones.filter(r => r.fechaRecibido === today && r.estado !== 'Anulada');
    let carteraToday = 0;
    todayRemisiones.forEach(r => {
        const paymentsArray = Array.isArray(r.payments) ? r.payments : [];
        const paidConfirmedToday = paymentsArray.filter(p => p.date === today && p.status === 'confirmado').reduce((sum, p) => sum + p.amount, 0);
        const saldo = r.valorTotal - paidConfirmedToday;
        if (saldo > 0) carteraToday += saldo;
    });

    const summaryDailySalesEl = document.getElementById('summary-daily-sales');
    if (summaryDailySalesEl) summaryDailySalesEl.textContent = formatCurrency(totalConfirmedToday);

    const breakdownContainer = document.getElementById('daily-sales-breakdown-cards');
    if (breakdownContainer) {
        let cardsHTML = '';
        METODOS_DE_PAGO.forEach(metodo => {
            cardsHTML += `
                <div class="bg-slate-50 border border-slate-100 p-3 sm:p-3.5 rounded-xl shadow-xs">
                    <div class="text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-wider">${metodo}</div>
                    <div class="text-base sm:text-lg font-black text-slate-800 mt-1">${formatCurrency(breakdown[metodo] || 0)}</div>
                </div>
            `;
        });
        cardsHTML += `
            <div class="bg-rose-50/60 border border-rose-100 p-3 sm:p-3.5 rounded-xl shadow-xs">
                <div class="text-[10px] sm:text-xs font-bold text-rose-800 uppercase tracking-wider">EN CARTERA (HOY)</div>
                <div class="text-base sm:text-lg font-black text-rose-700 mt-1">${formatCurrency(carteraToday)}</div>
            </div>
        `;
        if (totalConfirmedToday === 0 && carteraToday === 0) {
            cardsHTML = '<div class="col-span-full text-center text-sm text-gray-500 italic py-2">No hay movimientos hoy.</div>';
        }
        breakdownContainer.innerHTML = cardsHTML;
    }

    // GRAFICO: SOLO PAGOS CONFIRMADOS
    const monthNames = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
    const labels = []; const salesData = []; const expensesData = [];
    for (let i = 5; i >= 0; i--) {
        const d = new Date(); d.setMonth(d.getMonth() - i);
        const m = d.getMonth(); const y = d.getFullYear();
        labels.push(monthNames[m]);

        salesData.push(allRemisiones.flatMap(r => Array.isArray(r.payments) ? r.payments : [])
            .filter(p => { 
                const pDate = new Date(p.date + 'T00:00:00'); 
                return pDate.getMonth() === m && pDate.getFullYear() === y && p.status === 'confirmado'; 
            })
            .reduce((sum, p) => sum + p.amount, 0));
            
        expensesData.push(allGastos.filter(g => { const gDate = new Date(g.fecha + 'T00:00:00'); return gDate.getMonth() === m && gDate.getFullYear() === y; }).reduce((sum, g) => sum + g.valorTotal, 0));
    }
    
    const ctx = document.getElementById('profitLossChart')?.getContext('2d');
    if (ctx && window.Chart) {
        if (window.profitLossChartInstance) window.profitLossChartInstance.destroy();
        window.profitLossChartInstance = new window.Chart(ctx, {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    { 
                        label: 'Dinero Recibido (Pagos)', 
                        data: salesData, 
                        backgroundColor: '#80cbc4',
                        borderColor: '#4db6ac',
                        borderWidth: 1,
                        borderRadius: 4
                    }, 
                    { 
                        label: 'Gastos Pagados', 
                        data: expensesData, 
                        backgroundColor: '#f48fb1',
                        borderColor: '#f06292',
                        borderWidth: 1,
                        borderRadius: 4
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'top',
                        labels: {
                            font: {
                                size: 11,
                                weight: 'bold'
                            },
                            color: '#475569'
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        grid: {
                            color: '#f1f5f9'
                        },
                        ticks: {
                            color: '#64748b',
                            font: {
                                size: 10,
                                weight: 'bold'
                            },
                            callback: function(value) {
                                return formatCurrency(value);
                            }
                        }
                    },
                    x: {
                        grid: {
                            display: false
                        },
                        ticks: {
                            color: '#64748b',
                            font: {
                                size: 10,
                                weight: 'bold'
                            }
                        }
                    }
                }
            }
        });
    }
}

function calculateOverdueDays(dateString) {
    const today = new Date(); const receivedDate = new Date(dateString);
    today.setHours(0, 0, 0, 0); receivedDate.setHours(0, 0, 0, 0);
    const diffDays = Math.ceil((today - receivedDate) / (1000 * 60 * 60 * 24));
    return diffDays > 0 ? diffDays : 0;
}

// CARTERA DETALLE: SOLO RESTAR PAGOS CONFIRMADOS
function renderCartera() {
    const carteraListEl = document.getElementById('cartera-list');
    const carteraTotalEl = document.getElementById('cartera-total');
    const paginationContainer = document.getElementById('cartera-detalle-pagination');

    const pendingRemisiones = allRemisiones.filter(r => {
        if (r.estado === 'Anulada') return false;
        const paymentsArray = Array.isArray(r.payments) ? r.payments : [];
        return r.valorTotal - paymentsArray.filter(p => p.status === 'confirmado').reduce((sum, p) => sum + p.amount, 0) > 0.01;
    }).sort((a, b) => new Date(a.fechaRecibido) - new Date(b.fechaRecibido));

    carteraListEl.innerHTML = '';
    if (pendingRemisiones.length === 0) {
        carteraListEl.innerHTML = '<p class="text-center text-gray-500 py-8">¡No hay cartera pendiente!</p>';
        carteraTotalEl.innerHTML = '';
        if (paginationContainer) paginationContainer.innerHTML = '';
        return;
    }

    const totalItems = pendingRemisiones.length;
    const totalPages = Math.ceil(totalItems / carteraDetallePerPage) || 1;

    if (currentPageCarteraDetalle > totalPages) currentPageCarteraDetalle = totalPages;
    if (currentPageCarteraDetalle < 1) currentPageCarteraDetalle = 1;

    const startIndex = (currentPageCarteraDetalle - 1) * carteraDetallePerPage;
    const endIndex = startIndex + carteraDetallePerPage;
    const paginatedRemisiones = pendingRemisiones.slice(startIndex, endIndex);

    let totalCartera = 0;
    pendingRemisiones.forEach(r => {
        const paymentsArray = Array.isArray(r.payments) ? r.payments : [];
        const totalPagado = paymentsArray.filter(p => p.status === 'confirmado').reduce((sum, p) => sum + p.amount, 0);
        const saldoPendiente = r.valorTotal - totalPagado;
        totalCartera += saldoPendiente;
    });

    paginatedRemisiones.forEach(r => {
        const paymentsArray = Array.isArray(r.payments) ? r.payments : [];
        const totalPagado = paymentsArray.filter(p => p.status === 'confirmado').reduce((sum, p) => sum + p.amount, 0);
        const saldoPendiente = r.valorTotal - totalPagado;
        
        const overdueDays = calculateOverdueDays(r.fechaRecibido);
        let overdueColor = 'text-gray-600';
        if (overdueDays > 30) overdueColor = 'text-yellow-600';
        if (overdueDays > 60) overdueColor = 'text-red-600';

        const card = document.createElement('div');
        card.className = 'bg-white p-4 sm:p-5 rounded-2xl shadow-xs flex flex-col gap-3 hover:border-indigo-400 transition-colors duration-200';
        card.dataset.remisionJson = JSON.stringify(r); 

        card.innerHTML = `
            <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                <div class="flex-grow">
                    <p class="font-extrabold text-slate-800 text-base sm:text-lg">${r.clienteNombre}</p>
                    <p class="text-xs sm:text-sm text-slate-500 mt-0.5">Remisión N° <span class="font-mono bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded-md text-xs">${r.numeroRemision}</span> &bull; ${r.fechaRecibido}</p>
                </div>
                <div class="text-left sm:text-right w-full sm:w-auto flex-shrink-0 border-t sm:border-t-0 pt-2 sm:pt-0 mt-1 sm:mt-0"> 
                    <p class="text-[10px] sm:text-xs font-bold text-slate-400 uppercase tracking-wider">Saldo Pendiente</p>
                    <p class="font-black text-xl sm:text-2xl text-rose-600">${formatCurrency(saldoPendiente)}</p>
                </div>
            </div>
            <div class="mt-2 pt-3 border-t border-slate-100 text-xs sm:text-sm flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
                <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-slate-500">
                    <p><span class="font-semibold text-slate-700">Valor Total:</span> ${formatCurrency(r.valorTotal)}</p>
                    <span class="hidden sm:inline text-slate-300">&bull;</span>
                    <p class="${overdueColor} font-bold">${overdueDays} días de vencido</p>
                </div>
                <button class="cartera-payment-btn bg-indigo-650 hover:bg-indigo-755 text-white font-bold py-2 px-4 rounded-xl text-xs transition-colors shadow-xs w-full sm:w-auto text-center">Gestionar Pagos</button>
            </div>
        `;
        carteraListEl.appendChild(card);
    });
    carteraTotalEl.innerHTML = `Total Cartera: <span class="text-rose-650 font-black">${formatCurrency(totalCartera)}</span>`;

    if (paginationContainer) {
        paginationContainer.innerHTML = `
            <div class="flex flex-col sm:flex-row justify-between items-center gap-3 mt-4">
                <span class="text-xs font-medium text-slate-500 order-2 sm:order-1">Mostrando ${startIndex + 1} - ${Math.min(endIndex, totalItems)} de ${totalItems}</span>
                <div class="flex gap-2 order-1 sm:order-2 w-full sm:w-auto justify-between sm:justify-end">
                    <button id="prev-cartera-btn" class="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-bold rounded-lg transition-colors disabled:opacity-50" ${currentPageCarteraDetalle === 1 ? 'disabled' : ''}>Anterior</button>
                    <span class="px-3 py-1.5 text-xs font-bold text-slate-600">Pág ${currentPageCarteraDetalle} de ${totalPages}</span>
                    <button id="next-cartera-btn" class="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-bold rounded-lg transition-colors disabled:opacity-50" ${currentPageCarteraDetalle === totalPages ? 'disabled' : ''}>Siguiente</button>
                </div>
            </div>
        `;

        const prevBtn = document.getElementById('prev-cartera-btn');
        const nextBtn = document.getElementById('next-cartera-btn');
        if (prevBtn && currentPageCarteraDetalle > 1) prevBtn.addEventListener('click', () => { currentPageCarteraDetalle--; renderCartera(); });
        if (nextBtn && currentPageCarteraDetalle < totalPages) nextBtn.addEventListener('click', () => { currentPageCarteraDetalle++; renderCartera(); });
    }
    
    const oldListener = carteraListEl._paymentClickListener;
    if (oldListener) carteraListEl.removeEventListener('click', oldListener);

    const newListener = (event) => {
        const btn = event.target.closest('.cartera-payment-btn');
        if (btn) {
            const card = btn.closest('[data-remision-json]');
            if (card) {
                const remisionData = JSON.parse(card.dataset.remisionJson);
                const customEvent = new CustomEvent('openWaPaymentModal', { detail: remisionData });
                document.dispatchEvent(customEvent);
            }
        }
    };
    carteraListEl.addEventListener('click', newListener);
    carteraListEl._paymentClickListener = newListener;
}

// CARTERA CLIENTES: SOLO RESTAR PAGOS CONFIRMADOS
function renderCarteraClientes() {
    const container = document.getElementById('cartera-clientes-list');
    const totalEl = document.getElementById('cartera-clientes-total');
    const paginationContainer = document.getElementById('cartera-cliente-pagination');
    if (!container || !totalEl) return;

    const pendingRemisiones = allRemisiones.filter(r => {
        if (r.estado === 'Anulada') return false;
        const totalPagado = (Array.isArray(r.payments) ? r.payments : []).filter(p => p.status === 'confirmado').reduce((sum, p) => sum + p.amount, 0);
        return r.valorTotal - totalPagado > 0.01;
    });

    if (pendingRemisiones.length === 0) {
        container.innerHTML = '<p class="text-center text-gray-500 py-8">¡No hay cartera pendiente!</p>';
        totalEl.innerHTML = ''; 
        if (paginationContainer) paginationContainer.innerHTML = '';
        return;
    }

    const carteraPorCliente = {};
    let granTotal = 0;

    pendingRemisiones.forEach(r => {
        const totalPagado = (Array.isArray(r.payments) ? r.payments : []).filter(p => p.status === 'confirmado').reduce((sum, p) => sum + p.amount, 0);
        const saldo = r.valorTotal - totalPagado;
        const clienteId = r.idCliente || 'DESCONOCIDO';
        if (!carteraPorCliente[clienteId]) {
            carteraPorCliente[clienteId] = { nombre: r.clienteNombre || 'Cliente Desconocido', telefono: r.clienteTelefono || '', remisionesCount: 0, totalDeuda: 0 };
        }
        carteraPorCliente[clienteId].totalDeuda += saldo;
        carteraPorCliente[clienteId].remisionesCount += 1; 
        granTotal += saldo;
    });

    const clientesOrdenados = Object.values(carteraPorCliente).sort((a, b) => b.totalDeuda - a.totalDeuda);

    const totalItems = clientesOrdenados.length;
    const totalPages = Math.ceil(totalItems / carteraClientePerPage) || 1;

    if (currentPageCarteraCliente > totalPages) currentPageCarteraCliente = totalPages;
    if (currentPageCarteraCliente < 1) currentPageCarteraCliente = 1;

    const startIndex = (currentPageCarteraCliente - 1) * carteraClientePerPage;
    const endIndex = startIndex + carteraClientePerPage;
    const paginatedClientes = clientesOrdenados.slice(startIndex, endIndex);

    container.innerHTML = '';
    paginatedClientes.forEach(c => {
        const card = document.createElement('div');
        card.className = 'bg-white p-4 sm:p-5 rounded-2xl shadow-xs flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 hover:border-indigo-400 transition-colors duration-200';
        const labelRemisiones = c.remisionesCount === 1 ? 'remisión pendiente' : 'remisiones pendientes';
        card.innerHTML = `
            <div>
                <p class="font-extrabold text-slate-800 text-base sm:text-lg">${c.nombre}</p>
                <p class="text-xs sm:text-sm text-slate-500 mt-0.5"><span class="bg-amber-50 text-amber-800 text-xs font-semibold px-2 py-0.5 rounded-md">${c.remisionesCount} ${labelRemisiones}</span></p>
                ${c.telefono && c.telefono !== 'N/A' ? `<p class="text-xs text-slate-400 mt-2 flex items-center gap-1"><svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.94.725l.548 2.2a1 1 0 01-.321.988l-1.305.98a10.582 10.582 0 004.872 4.872l.98-1.305a1 1 0 01.988-.321l2.2.548a1 1 0 01.725.94V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/></svg> ${c.telefono}</p>` : ''}
            </div>
            <div class="text-left sm:text-right w-full sm:w-auto border-t sm:border-t-0 pt-2 sm:pt-0 mt-2 sm:mt-0 flex-shrink-0">
                <p class="text-[10px] sm:text-xs font-bold text-slate-400 uppercase tracking-wider">Deuda Total</p>
                <p class="font-black text-xl sm:text-2xl text-rose-600">${formatCurrency(c.totalDeuda)}</p>
            </div>
        `;
        container.appendChild(card);
    });
    totalEl.innerHTML = `Total Cartera: <span class="text-rose-650 font-black">${formatCurrency(granTotal)}</span>`;

    if (paginationContainer) {
        paginationContainer.innerHTML = `
            <div class="flex flex-col sm:flex-row justify-between items-center gap-3 mt-4">
                <span class="text-xs font-medium text-slate-500 order-2 sm:order-1">Mostrando ${startIndex + 1} - ${Math.min(endIndex, totalItems)} de ${totalItems}</span>
                <div class="flex gap-2 order-1 sm:order-2 w-full sm:w-auto justify-between sm:justify-end">
                    <button id="prev-cartera-cliente-btn" class="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-bold rounded-lg transition-colors disabled:opacity-50" ${currentPageCarteraCliente === 1 ? 'disabled' : ''}>Anterior</button>
                    <span class="px-3 py-1.5 text-xs font-bold text-slate-600">Pág ${currentPageCarteraCliente} de ${totalPages}</span>
                    <button id="next-cartera-cliente-btn" class="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-bold rounded-lg transition-colors disabled:opacity-50" ${currentPageCarteraCliente === totalPages ? 'disabled' : ''}>Siguiente</button>
                </div>
            </div>
        `;

        const prevBtn = document.getElementById('prev-cartera-cliente-btn');
        const nextBtn = document.getElementById('next-cartera-cliente-btn');
        if (prevBtn && currentPageCarteraCliente > 1) prevBtn.addEventListener('click', () => { currentPageCarteraCliente--; renderCarteraClientes(); });
        if (nextBtn && currentPageCarteraCliente < totalPages) nextBtn.addEventListener('click', () => { currentPageCarteraCliente++; renderCarteraClientes(); });
    }
}

function renderTopClientes() {
    const container = document.getElementById('top-clientes-list');
    const paginationContainer = document.getElementById('top-clientes-pagination');
    if (!container) return;

    let remisionesToAnalyze = allRemisiones;
    if (currentTopClientesStartDate && currentTopClientesEndDate) {
        remisionesToAnalyze = allRemisiones.filter(r => {
            const d = new Date(r.fechaRecibido);
            return d >= currentTopClientesStartDate && d <= currentTopClientesEndDate;
        });
    }

    const clientesConHistorial = allClientes.map(cliente => {
        const remisionesCliente = remisionesToAnalyze.filter(r => r.idCliente === cliente.id && r.estado !== 'Anulada');
        const totalComprado = remisionesCliente.reduce((sum, r) => sum + r.valorTotal, 0);
        return { ...cliente, totalComprado, numCompras: remisionesCliente.length };
    }).filter(c => c.numCompras > 0).sort((a, b) => b.totalComprado - a.totalComprado);

    container.innerHTML = '';
    if (clientesConHistorial.length === 0) {
        container.innerHTML = '<p class="text-center text-gray-500 py-8">No hay datos de compras de clientes para el rango seleccionado.</p>';
        if (paginationContainer) paginationContainer.innerHTML = '';
        return;
    }

    const totalItems = clientesConHistorial.length;
    const totalPages = Math.ceil(totalItems / topClientesPerPage) || 1;

    if (currentPageTopClientes > totalPages) currentPageTopClientes = totalPages;
    if (currentPageTopClientes < 1) currentPageTopClientes = 1;

    const startIndex = (currentPageTopClientes - 1) * topClientesPerPage;
    const endIndex = startIndex + topClientesPerPage;
    const paginatedClientes = clientesConHistorial.slice(startIndex, endIndex);

    paginatedClientes.forEach((cliente, index) => {
        const el = document.createElement('div');
        el.className = 'bg-white p-4 sm:p-5 rounded-2xl shadow-xs flex justify-between items-center gap-4 hover:border-indigo-400 transition-colors duration-200';
        
        const absoluteIndex = startIndex + index;
        let rankBadgeClass = "bg-slate-100 text-slate-700 border-slate-200";
        if (absoluteIndex === 0) rankBadgeClass = "bg-amber-500 text-white border-amber-600 shadow-sm";
        else if (absoluteIndex === 1) rankBadgeClass = "bg-slate-350 text-white border-slate-400 shadow-sm";
        else if (absoluteIndex === 2) rankBadgeClass = "bg-amber-650 text-white border-amber-700 shadow-sm";

        el.innerHTML = `
            <div class="flex items-center gap-3">
                <div class="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-extrabold border ${rankBadgeClass}">
                    #${absoluteIndex + 1}
                </div>
                <div>
                    <p class="font-extrabold text-slate-800 text-base sm:text-lg">${cliente.nombre}</p>
                    <p class="text-xs text-slate-400 font-medium mt-0.5">${cliente.numCompras} ${cliente.numCompras === 1 ? 'compra' : 'compras'}</p>
                </div>
            </div>
            <div class="text-right flex-shrink-0">
                <p class="text-[10px] sm:text-xs font-bold text-slate-400 uppercase tracking-wider mb-0.5">Total Comprado</p>
                <p class="font-black text-lg sm:text-xl text-emerald-600">${formatCurrency(cliente.totalComprado)}</p>
            </div>
        `;
        container.appendChild(el);
    });

    if (paginationContainer) {
        paginationContainer.innerHTML = `
            <div class="flex flex-col sm:flex-row justify-between items-center gap-3 mt-4">
                <span class="text-xs font-medium text-slate-500 order-2 sm:order-1">Mostrando ${startIndex + 1} - ${Math.min(endIndex, totalItems)} de ${totalItems}</span>
                <div class="flex gap-2 order-1 sm:order-2 w-full sm:w-auto justify-between sm:justify-end">
                    <button id="prev-top-clientes-btn" class="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-bold rounded-lg transition-colors disabled:opacity-50" ${currentPageTopClientes === 1 ? 'disabled' : ''}>Anterior</button>
                    <span class="px-3 py-1.5 text-xs font-bold text-slate-600">Pág ${currentPageTopClientes} de ${totalPages}</span>
                    <button id="next-top-clientes-btn" class="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-bold rounded-lg transition-colors disabled:opacity-50" ${currentPageTopClientes === totalPages ? 'disabled' : ''}>Siguiente</button>
                </div>
            </div>
        `;

        const prevBtn = document.getElementById('prev-top-clientes-btn');
        const nextBtn = document.getElementById('next-top-clientes-btn');
        if (prevBtn && currentPageTopClientes > 1) prevBtn.addEventListener('click', () => { currentPageTopClientes--; renderTopClientes(); });
        if (nextBtn && currentPageTopClientes < totalPages) nextBtn.addEventListener('click', () => { currentPageTopClientes++; renderTopClientes(); });
    }
}

// --- OPTIMIZACIÓN 2: TRANSFERENCIAS CON CACHE Y PAGINACIÓN ---
const TRANSF_CACHE_KEY = 'transferencias_cache';
const TRANSF_SYNC_KEY = 'transferencias_last_sync';
let allConfirmedTransfers = [];
let currentPageTransfers = 1;
const transfersPerPage = 15;

async function loadConfirmedTransfers() {
    const listContainer = document.getElementById('transferencias-list');
    if (!listContainer) return;

    listContainer.innerHTML = '<p class="text-gray-500 text-center py-4">Cargando historial...</p>';

    const cachedData = localStorage.getItem(TRANSF_CACHE_KEY);
    const lastSyncStr = localStorage.getItem(TRANSF_SYNC_KEY);
    
    let lastSync = null;
    let mapTransfers = new Map();

    if (cachedData) {
        try {
            allConfirmedTransfers = JSON.parse(cachedData);
            allConfirmedTransfers.forEach(t => mapTransfers.set(t.id, t));
            renderConfirmedTransfersList(); 
        } catch (e) {
            localStorage.removeItem(TRANSF_CACHE_KEY);
        }
    }

    if (lastSyncStr) lastSync = new Date(parseInt(lastSyncStr));

    try {
        const colRef = collection(db, "transferencias");
        let q;
        
        if (lastSync) {
            const syncTime = new Date(lastSync.getTime() - 60000);
            q = query(colRef, where("estado", "==", "confirmada"), where("_lastUpdated", ">=", syncTime));
        } else {
            q = query(colRef, where("estado", "==", "confirmada"));
        }

        const snapshot = await getDocs(q);
        let huboCambios = false;

        snapshot.forEach(doc => {
            const data = doc.data();
            if (data.confirmadoEn && typeof data.confirmadoEn.toMillis === 'function') data.confirmadoEn = data.confirmadoEn.toMillis();
            if (data.fechaRegistro && typeof data.fechaRegistro.toMillis === 'function') data.fechaRegistro = data.fechaRegistro.toMillis();
            if (data._lastUpdated && typeof data._lastUpdated.toMillis === 'function') data._lastUpdated = data._lastUpdated.toMillis();
            
            mapTransfers.set(doc.id, { id: doc.id, ...data });
            huboCambios = true;
        });

        if (huboCambios || !lastSync) {
            allConfirmedTransfers = Array.from(mapTransfers.values());
            allConfirmedTransfers.sort((a, b) => b.confirmadoEn - a.confirmadoEn); 
            
            localStorage.setItem(TRANSF_CACHE_KEY, JSON.stringify(allConfirmedTransfers));
            localStorage.setItem(TRANSF_SYNC_KEY, Date.now().toString());

            renderConfirmedTransfersList();
        }
    } catch (error) {
        console.error("Error sincronizando transferencias:", error);
    }
}

function updateLocalTransfersCache(newTransfer) {
    const cachedData = localStorage.getItem(TRANSF_CACHE_KEY);
    let transfers = cachedData ? JSON.parse(cachedData) : [];
    
    const index = transfers.findIndex(t => t.id === newTransfer.id);
    if (index !== -1) transfers[index] = newTransfer;
    else transfers.push(newTransfer);
    
    transfers.sort((a, b) => b.confirmadoEn - a.confirmadoEn);
    
    localStorage.setItem(TRANSF_CACHE_KEY, JSON.stringify(transfers));
    allConfirmedTransfers = transfers;
}

function renderConfirmedTransfersList() {
    const listContainer = document.getElementById('transferencias-list');
    const paginationContainer = document.getElementById('transferencias-pagination');
    const monthFilter = document.getElementById('filter-transfer-month');
    const yearFilter = document.getElementById('filter-transfer-year');
    
    if (!listContainer) return;

    const selectedMonth = monthFilter ? monthFilter.value : 'all';
    const selectedYear = yearFilter ? yearFilter.value : 'all';

    let filtered = allConfirmedTransfers;

    if (selectedYear !== 'all') {
        filtered = filtered.filter(t => new Date(t.confirmadoEn).getFullYear() == selectedYear);
    }
    if (selectedMonth !== 'all') {
        filtered = filtered.filter(t => new Date(t.confirmadoEn).getMonth() == selectedMonth);
    }

    const totalItems = filtered.length;
    const totalPages = Math.ceil(totalItems / transfersPerPage) || 1;

    if (currentPageTransfers > totalPages) currentPageTransfers = totalPages;
    if (currentPageTransfers < 1) currentPageTransfers = 1;

    const startIndex = (currentPageTransfers - 1) * transfersPerPage;
    const endIndex = startIndex + transfersPerPage;
    const paginatedTransfers = filtered.slice(startIndex, endIndex);

    listContainer.innerHTML = ''; 
    if (totalItems === 0) {
        listContainer.innerHTML = '<p class="text-center text-gray-500 py-4">No se encontraron transferencias confirmadas para este período.</p>';
        if (paginationContainer) paginationContainer.innerHTML = '';
        return;
    }

    paginatedTransfers.forEach(transfer => {
        const el = document.createElement('div');
        el.className = 'bg-white p-4 sm:p-5 rounded-2xl shadow-xs grid grid-cols-1 md:grid-cols-3 gap-4 items-start hover:border-indigo-400 transition-colors duration-200';

        let fechaConfirmacionStr = new Date(transfer.confirmadoEn).toLocaleDateString();
        let horaConfirmacionStr = new Date(transfer.confirmadoEn).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        let fechaRegistroStr = transfer.fechaRegistro ? new Date(transfer.fechaRegistro).toLocaleDateString() : 'N/A';
        const fechaTransferenciaStr = transfer.fechaTransferencia ? new Date(transfer.fechaTransferencia + 'T00:00:00').toLocaleDateString() : fechaRegistroStr;

        const registradoPorNombre = allUsers.find(u => u.id === transfer.registradoPor)?.nombre || 'Desconocido';
        const confirmadoPorNombre = allUsers.find(u => u.id === transfer.confirmadoPor)?.nombre || 'Desconocido';

        el.innerHTML = `
            <div class="md:col-span-1 space-y-2">
                <p class="font-black text-xl text-indigo-655">${formatCurrency(transfer.monto)}</p>
                <div class="flex items-center gap-1.5 flex-wrap">
                    <span class="bg-rose-50 text-rose-700 px-2 py-0.5 rounded-md text-xs font-bold border border-rose-100">${transfer.cuentaOrigen}</span> 
                    <span class="text-slate-400 text-xs font-bold">&rarr;</span> 
                    <span class="bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-md text-xs font-bold border border-emerald-100">${transfer.cuentaDestino}</span>
                </div>
                <p class="text-xs text-slate-400 font-medium">Fecha Transf: ${fechaTransferenciaStr}</p>
                ${transfer.referencia ? `<p class="text-xs text-slate-500 bg-slate-50 border border-slate-100 p-1.5 rounded-lg italic break-all">Ref: ${transfer.referencia}</p>` : ''}
            </div>
            <div class="md:col-span-1 text-xs text-slate-600 border-t md:border-t-0 md:border-l md:border-slate-100 md:pl-4 pt-3 md:pt-0 space-y-1">
                <p class="font-bold text-slate-700 uppercase tracking-wider text-[10px]">Registrado</p>
                <p><span class="font-medium text-slate-500">Por:</span> ${registradoPorNombre}</p>
                <p><span class="font-medium text-slate-500">Fecha:</span> ${fechaRegistroStr}</p>
            </div>
            <div class="md:col-span-1 text-xs text-slate-600 border-t md:border-t-0 md:border-l md:border-slate-100 md:pl-4 pt-3 md:pt-0 space-y-1">
                <p class="font-bold text-slate-700 uppercase tracking-wider text-[10px]">Confirmado</p>
                <p><span class="font-medium text-slate-500">Por:</span> ${confirmadoPorNombre}</p>
                <p><span class="font-medium text-slate-500">Fecha:</span> ${fechaConfirmacionStr} &bull; ${horaConfirmacionStr}</p>
            </div>
        `;
        listContainer.appendChild(el);
    });

    if (paginationContainer) {
        paginationContainer.innerHTML = `
            <div class="flex flex-col sm:flex-row justify-between items-center gap-3 mt-4">
                <span class="text-xs font-medium text-slate-500 order-2 sm:order-1">Mostrando ${startIndex + 1} - ${Math.min(endIndex, totalItems)} de ${totalItems}</span>
                <div class="flex gap-2 order-1 sm:order-2 w-full sm:w-auto justify-between sm:justify-end">
                    <button id="prev-transf-btn" class="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-bold rounded-lg transition-colors disabled:opacity-50" ${currentPageTransfers === 1 ? 'disabled' : ''}>Anterior</button>
                    <span class="px-3 py-1.5 text-xs font-bold text-slate-600">Pág ${currentPageTransfers} de ${totalPages}</span>
                    <button id="next-transf-btn" class="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-bold rounded-lg transition-colors disabled:opacity-50" ${currentPageTransfers === totalPages ? 'disabled' : ''}>Siguiente</button>
                </div>
            </div>
        `;

        const prevBtn = document.getElementById('prev-transf-btn');
        const nextBtn = document.getElementById('next-transf-btn');
        if (prevBtn && currentPageTransfers > 1) prevBtn.addEventListener('click', () => { currentPageTransfers--; renderConfirmedTransfersList(); });
        if (nextBtn && currentPageTransfers < totalPages) nextBtn.addEventListener('click', () => { currentPageTransfers++; renderConfirmedTransfersList(); });
    }
}

// --- OPTIMIZACIÓN 3: TRANSFERENCIAS PENDIENTES (Mantiene onSnapshot por ser cola en vivo) ---
function renderPendingTransfers() {
    const container = document.getElementById('pending-transfers-list');
    const section = document.getElementById('pending-transfers-section');

    if (_unsubscribePendingTransfers) {
        _unsubscribePendingTransfers();
        _unsubscribePendingTransfers = null;
    }

    if (!container || !section || !currentUserData || currentUserData.role !== 'admin') {
        section?.classList.add('hidden'); return; 
    }

    const q = query(collection(db, "transferencias"), where("estado", "==", "pendiente"));
    _unsubscribePendingTransfers = onSnapshot(q, (snapshot) => {
        const pendingTransfers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        if (pendingTransfers.length === 0) {
            container.innerHTML = '<p class="text-sm text-gray-500">No hay transferencias pendientes.</p>';
            section.classList.add('hidden'); return;
        }

        section.classList.remove('hidden'); container.innerHTML = ''; 

        pendingTransfers.forEach(transfer => {
            const el = document.createElement('div');
            el.className = 'bg-white p-4 rounded-2xl shadow-xs border border-amber-100 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3';
            const canConfirm = currentUser.uid !== transfer.registradoPor;
            const fechaRegistro = transfer.fechaRegistro ? new Date(transfer.fechaRegistro.seconds * 1000).toLocaleDateString() : 'Fecha no disponible';
            const fechaMostrar = transfer.fechaTransferencia || fechaRegistro;

            el.innerHTML = `
                <div class="space-y-1.5 w-full sm:w-auto">
                    <p class="font-black text-lg text-slate-800">${formatCurrency(transfer.monto)}</p>
                    <div class="flex items-center gap-1.5 flex-wrap">
                        <span class="bg-rose-50 text-rose-700 px-2 py-0.5 rounded-md text-xs font-bold border border-rose-100">${transfer.cuentaOrigen}</span> 
                        <span class="text-slate-400 text-xs font-bold">&rarr;</span> 
                        <span class="bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-md text-xs font-bold border border-emerald-100">${transfer.cuentaDestino}</span>
                    </div>
                    <p class="text-xs text-slate-400 font-medium">Fecha Transf: ${fechaMostrar}</p>
                    ${transfer.referencia ? `<p class="text-xs text-slate-500 bg-slate-50 border border-slate-100 p-1.5 rounded-lg italic break-all">Ref: ${transfer.referencia}</p>` : ''}
                <div class="flex gap-2 w-full sm:w-auto">
                    <button data-transfer-id="${transfer.id}" class="confirm-transfer-btn flex-1 sm:flex-none text-center font-bold px-4 py-2.5 rounded-xl text-xs transition-colors shadow-sm bg-emerald-600 hover:bg-emerald-700 text-white ${!canConfirm ? 'opacity-40 cursor-not-allowed !bg-slate-400 !text-slate-600' : ''}" ${!canConfirm ? 'disabled title="Otro admin debe confirmar"' : ''}>
                        ✓ Confirmar
                    </button>
                    <button data-transfer-id="${transfer.id}" class="reject-transfer-btn flex-1 sm:flex-none text-center font-bold px-4 py-2.5 rounded-xl text-xs transition-colors shadow-sm bg-red-600 hover:bg-red-700 text-white ${!canConfirm ? 'opacity-40 cursor-not-allowed !bg-slate-400 !text-slate-600' : ''}" ${!canConfirm ? 'disabled title="Otro admin debe rechazar"' : ''}>
                        ✕ Rechazar
                    </button>
                </div>
            `;
            container.appendChild(el);
        });
    }, (error) => {
        console.warn("Error en onSnapshot de transferencias pendientes:", error.message || error);
    });

    container.removeEventListener('click', handleConfirmTransferClick);
    container.addEventListener('click', handleConfirmTransferClick);
}

function handleConfirmTransferClick(e) {
    const confirmButton = e.target.closest('.confirm-transfer-btn:not([disabled])');
    if (confirmButton) { handleConfirmTransfer(e); return; }
    const rejectButton = e.target.closest('.reject-transfer-btn:not([disabled])');
    if (rejectButton) handleRejectTransfer(rejectButton);
}

async function handleConfirmTransfer(e) {
    const transferId = e.target.dataset.transferId;
    if (!transferId) return;

    if (!confirm("¿Estás seguro de que quieres confirmar esta transferencia? Esta acción registrará los gastos correspondientes.")) return;

    showModalMessage("Confirmando transferencia...", true);
    try {
        const confirmTransfer = httpsCallable(functions, 'confirmTransfer');
        const result = await confirmTransfer({ transferId: transferId });
        
        // Actualizamos localmente el caché si la función devuelve la transferencia confirmada
        if(result.data && result.data.transferencia) {
            updateLocalTransfersCache(result.data.transferencia);
            currentPageTransfers = 1;
            renderConfirmedTransfersList();
        } else {
             // Si la function no devuelve data, forzamos recarga desde Firebase
             loadConfirmedTransfers();
        }

        hideModal(); showTemporaryMessage("¡Transferencia confirmada!", "success");
    } catch (error) {
        console.error("Error al confirmar:", error); showModalMessage(`Error: ${error.message}`);
    }
}

async function handleRejectTransfer(button) {
    const transferId = button.dataset.transferId;
    if (!transferId) return;

    if (!confirm("¿Estás seguro de que quieres RECHAZAR esta transferencia? Se eliminará permanentemente.")) return;

    showModalMessage("Rechazando transferencia...", true);
    try {
        const transferRef = doc(db, "transferencias", transferId);
        await deleteDoc(transferRef);
        hideModal();
        showTemporaryMessage("Transferencia rechazada y eliminada.", "info");
    } catch (error) {
        console.error("Error al rechazar:", error);
        showModalMessage(`Error al rechazar: ${error.message}`);
    }
}

function showTransferModal() {
    const modalContentWrapper = document.getElementById('modal-content-wrapper');
    const origenOptions = METODOS_DE_PAGO.map(m => `<option value="${m}">${m}</option>`).join('');

    modalContentWrapper.innerHTML = `
        <div class="modal-card max-w-md w-full mx-auto" style="height: auto; max-height: 85vh;">
            <div class="modal-header-fixed">
                <h2 class="text-xl font-bold text-slate-800">Registrar Transferencia</h2>
                <button id="close-transfer-modal" class="text-gray-500 hover:text-gray-800 text-3xl">&times;</button>
            </div>
            <form id="transfer-form" class="modal-body-scroll p-6 space-y-4">
                <div>
                    <label class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Cuenta Origen</label>
                    <select id="transfer-origen" class="w-full p-2.5 border border-slate-300 rounded-xl bg-white shadow-xs focus:ring-2 focus:ring-indigo-500 text-sm" required>
                        <option value="">-- Seleccionar --</option>
                        ${origenOptions}
                    </select>
                </div>
                <div>
                    <label class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Cuenta Destino</label>
                    <select id="transfer-destino" class="w-full p-2.5 border border-slate-300 rounded-xl bg-white shadow-xs focus:ring-2 focus:ring-indigo-500 text-sm" required>
                        <option value="">-- Seleccionar --</option>
                    </select>
                </div>
                <div>
                    <label class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Fecha de Transferencia</label>
                    <input type="date" id="transfer-fecha" class="w-full p-2.5 border border-slate-300 rounded-xl bg-white shadow-xs focus:ring-2 focus:ring-indigo-500 text-sm" value="${new Date().toISOString().split('T')[0]}" required>
                </div>
                <div>
                    <label class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Monto (COP)</label>
                    <input type="text" id="transfer-amount" inputmode="numeric" class="w-full p-2.5 border border-slate-300 rounded-xl bg-white shadow-xs focus:ring-2 focus:ring-indigo-500 text-sm" required>
                </div>
                <div>
                    <label class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Referencia (Opcional)</label>
                    <input type="text" id="transfer-reference" class="w-full p-2.5 border border-slate-300 rounded-xl bg-white shadow-xs focus:ring-2 focus:ring-indigo-500 text-sm">
                </div>
                <button type="submit" class="w-full bg-yellow-600 hover:bg-yellow-700 text-white font-bold py-3 rounded-xl transition-colors shadow-xs mt-2">Registrar Transferencia</button>
            </form>
        </div>
    `;
    document.getElementById('modal').classList.remove('hidden');
    document.getElementById('close-transfer-modal').addEventListener('click', hideModal);

    const origenSelect = document.getElementById('transfer-origen');
    const destinoSelect = document.getElementById('transfer-destino');
    origenSelect.addEventListener('change', () => {
        destinoSelect.innerHTML = '<option value="">-- Seleccionar --</option>';
        METODOS_DE_PAGO.forEach(m => { if (m !== origenSelect.value) destinoSelect.innerHTML += `<option value="${m}">${m}</option>`; });
    });

    const amountInput = document.getElementById('transfer-amount');
    amountInput.addEventListener('focus', (e) => unformatCurrencyInput(e.target));
    amountInput.addEventListener('blur', (e) => formatCurrencyInput(e.target));

    document.getElementById('transfer-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const origen = document.getElementById('transfer-origen').value;
        const destino = document.getElementById('transfer-destino').value;
        const amount = unformatCurrency(document.getElementById('transfer-amount').value);
        const reference = document.getElementById('transfer-reference').value;
        const fechaTransferencia = document.getElementById('transfer-fecha').value;

        if (!origen || !destino || origen === destino || isNaN(amount) || amount <= 0 || !fechaTransferencia) {
            return showModalMessage("Verifica los datos de la transferencia.");
        }

        const submitBtn = e.target.querySelector('button[type="submit"]');
        submitBtn.disabled = true; submitBtn.textContent = 'Procesando...';

        showModalMessage("Registrando transferencia...", true);
        try {
            const recordTransfer = httpsCallable(functions, 'recordTransfer');
            await recordTransfer({ cuentaOrigen: origen, cuentaDestino: destino, monto: amount, referencia: reference, fechaTransferencia: fechaTransferencia });
            hideModal(); showTemporaryMessage("Transferencia registrada.", "success");
        } catch (error) { 
            showModalMessage(`Error: ${error.message}`); 
        } finally {
            submitBtn.disabled = false; submitBtn.textContent = 'Registrar Transferencia';
        }
    });
}

// --- UTILIDADES ---
async function showInitialBalanceModal() {
    const modalContentWrapper = document.getElementById('modal-content-wrapper');
    
    // Obtenemos del caché local primero para velocidad
    let balances = { ...initialBalances }; 

    const balanceFieldsHTML = METODOS_DE_PAGO.map(metodo => `
        <div><label class="block text-sm font-medium">${metodo}</label><input type="text" id="balance-${metodo.toLowerCase()}" class="cost-input-cop w-full p-2 border rounded-lg mt-1" value="${formatCurrency(balances[metodo] || 0)}"></div>
    `).join('');

    modalContentWrapper.innerHTML = `
        <div class="modal-card max-w-md w-full mx-auto" style="height: auto; max-height: 85vh;">
            <div class="modal-header-fixed">
                <h2 class="text-xl font-bold text-slate-800">Establecer Saldos Iniciales</h2>
                <button id="close-balance-modal" class="text-gray-500 hover:text-gray-800 text-3xl">&times;</button>
            </div>
            <form id="initial-balance-form" class="modal-body-scroll p-6 space-y-4">
                <p class="text-xs text-slate-500 mb-2">Ingresa el saldo base de cada cuenta para comenzar el registro financiero.</p>
                ${balanceFieldsHTML}
                <button type="submit" class="w-full bg-indigo-650 hover:bg-indigo-755 text-white font-bold py-3 rounded-xl transition-colors shadow-xs mt-2">Guardar Saldos</button>
            </form>
        </div>
    `;

    document.getElementById('modal').classList.remove('hidden');
    document.getElementById('close-balance-modal').addEventListener('click', hideModal);

    document.querySelectorAll('.cost-input-cop').forEach(input => {
        input.addEventListener('focus', (e) => unformatCurrencyInput(e.target));
        input.addEventListener('blur', (e) => formatCurrencyInput(e.target));
    });

    document.getElementById('initial-balance-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const submitButton = e.target.querySelector('button[type="submit"]');
        submitButton.disabled = true; submitButton.textContent = 'Guardando...';

        const balancesToSave = {};
        METODOS_DE_PAGO.forEach(metodo => {
            balancesToSave[metodo] = unformatCurrency(document.getElementById(`balance-${metodo.toLowerCase()}`).value);
        });

        try {
            const setBalances = httpsCallable(functions, 'setInitialBalances');
            await setBalances(balancesToSave);
            
            Object.assign(initialBalances, balancesToSave); 
            localStorage.setItem(BALANCES_CACHE_KEY, JSON.stringify(balancesToSave));

            if(window.Swal) window.Swal.fire('¡Éxito!', 'Saldos iniciales guardados.', 'success');
            hideModal();
            updateDashboard(new Date().getFullYear(), new Date().getMonth()); 
        } catch (error) {
            console.error("Error al guardar saldos:", error);
            if(window.Swal) window.Swal.fire('Error', 'No se pudieron guardar los saldos.', 'error');
        } finally {
            submitButton.disabled = false; submitButton.textContent = 'Guardar Saldos';
        }
    });
}

function showReportDateRangeModal() {
    const modalContentWrapper = document.getElementById('modal-content-wrapper');
    const now = new Date();
    const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

    let monthOptions = '';
    for (let i = 0; i < 12; i++) monthOptions += `<option value="${i}" ${i === now.getMonth() ? 'selected' : ''}>${monthNames[i]}</option>`;
    let yearOptions = '';
    for (let i = 0; i < 5; i++) { const year = now.getFullYear() - i; yearOptions += `<option value="${year}">${year}</option>`; }

    modalContentWrapper.innerHTML = `
        <div class="modal-card max-w-md w-full mx-auto" style="height: auto; max-height: 85vh;">
            <div class="modal-header-fixed">
                <h2 class="text-xl font-bold text-slate-800">Reporte Financiero</h2>
                <button id="close-report-range-modal" class="text-gray-500 hover:text-gray-800 text-3xl">&times;</button>
            </div>
            <form id="report-range-form" class="modal-body-scroll p-6 space-y-4">
                <p class="text-xs text-slate-500 mb-2">Selecciona el rango de fechas para generar el reporte de ventas, gastos y utilidades en PDF.</p>
                <div class="space-y-1">
                    <label class="block text-xs font-bold text-slate-500 uppercase tracking-wider">Inicio del Periodo</label>
                    <div class="grid grid-cols-2 gap-2">
                        <select id="report-start-month" class="p-2.5 border border-slate-300 rounded-xl bg-white text-sm w-full">${monthOptions}</select>
                        <select id="report-start-year" class="p-2.5 border border-slate-300 rounded-xl bg-white text-sm w-full">${yearOptions}</select>
                    </div>
                </div>
                <div class="space-y-1">
                    <label class="block text-xs font-bold text-slate-500 uppercase tracking-wider">Fin del Periodo</label>
                    <div class="grid grid-cols-2 gap-2">
                        <select id="report-end-month" class="p-2.5 border border-slate-300 rounded-xl bg-white text-sm w-full">${monthOptions}</select>
                        <select id="report-end-year" class="p-2.5 border border-slate-300 rounded-xl bg-white text-sm w-full">${yearOptions}</select>
                    </div>
                </div>
                <button type="submit" class="w-full bg-indigo-650 hover:bg-indigo-755 text-white font-bold py-3 rounded-xl transition-colors shadow-xs mt-4">Generar Reporte PDF</button>
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
    if (!window.jspdf || !window.jspdf.jsPDF) {
        return showModalMessage("Error: jsPDF no está cargado correctamente.", "error");
    }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
    const startDate = new Date(startYear, startMonth, 1);
    const endDate = new Date(endYear, endMonth + 1, 0);

    const rangeTitle = `${monthNames[startMonth]} ${startYear} - ${monthNames[endMonth]} ${endYear}`;
    doc.setFontSize(20);
    doc.text(`Reporte Financiero: ${rangeTitle}`, 105, 20, { align: "center" });

    const accountBalances = {};
    METODOS_DE_PAGO.forEach(metodo => { accountBalances[metodo] = initialBalances[metodo] || 0; });

    // REPORTE PDF: SOLO PAGOS CONFIRMADOS
    const salesInRange = allRemisiones.flatMap(r => r.payments || [])
        .filter(p => { 
            const d = new Date(p.date); 
            return d >= startDate && d <= endDate && p.status === 'confirmado'; 
        })
        .reduce((sum, p) => sum + p.amount, 0);
        
    const expensesInRange = allGastos.filter(g => { const d = new Date(g.fecha); return d >= startDate && d <= endDate; }).reduce((sum, g) => sum + g.valorTotal, 0);
    const profitInRange = salesInRange - expensesInRange;

    const summaryData = [
        ['Ventas Totales en el Período', formatCurrency(salesInRange)],
        ['Gastos Totales en el Período', formatCurrency(expensesInRange)],
        ['Utilidad/Pérdida Total', formatCurrency(profitInRange)],
    ];

    if(doc.autoTable) {
        doc.autoTable({ startY: 30, head: [['Resumen del Período', 'Valor']], body: summaryData, theme: 'grid', headStyles: { fillColor: [41, 128, 185] } });
    }

    const monthlyData = [];
    let currentDate = new Date(startDate);
    while (currentDate <= endDate) {
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth();
        
        const monthlySales = allRemisiones.flatMap(r => r.payments || [])
            .filter(p => { 
                const d = new Date(p.date); 
                return d.getMonth() === month && d.getFullYear() === year && p.status === 'confirmado'; 
            })
            .reduce((sum, p) => sum + p.amount, 0);
            
        const monthlyExpenses = allGastos.filter(g => { const d = new Date(g.fecha); return d.getMonth() === month && d.getFullYear() === year; }).reduce((sum, g) => sum + g.valorTotal, 0);
        const monthlyProfit = monthlySales - monthlyExpenses;
        
        const endOfMonth = new Date(year, month + 1, 0);
        const carteraAtEndOfMonth = allRemisiones.filter(r => new Date(r.fechaRecibido) <= endOfMonth && r.estado !== 'Anulada')
            .reduce((sum, r) => { 
                const totalPagado = (r.payments || [])
                    .filter(p => new Date(p.date) <= endOfMonth && p.status === 'confirmado')
                    .reduce((s, p) => s + p.amount, 0); 
                const saldo = r.valorTotal - totalPagado; 
                return sum + (saldo > 0 ? saldo : 0); 
            }, 0);

        monthlyData.push([`${monthNames[month]} ${year}`, formatCurrency(monthlySales), formatCurrency(monthlyExpenses), formatCurrency(monthlyProfit), formatCurrency(carteraAtEndOfMonth)]);
        currentDate.setMonth(currentDate.getMonth() + 1);
    }

    if(doc.autoTable) {
        doc.autoTable({ startY: doc.lastAutoTable ? doc.lastAutoTable.finalY + 10 : 70, head: [['Mes', 'Ventas', 'Gastos', 'Utilidad/Pérdida', 'Cartera al Cierre']], body: monthlyData, theme: 'striped', headStyles: { fillColor: [22, 160, 133] } });
    }

    // PDF SALDOS FINALES
    allRemisiones.forEach(r => (r.payments || []).forEach(p => { 
        if (p.status === 'confirmado' && accountBalances[p.method] !== undefined) {
            accountBalances[p.method] += p.amount; 
        }
    }));
    
    allGastos.forEach(g => { if (accountBalances[g.fuentePago] !== undefined) accountBalances[g.fuentePago] -= g.valorTotal; });

    const totalCartera = allRemisiones.filter(r => r.estado !== 'Anulada').reduce((sum, r) => { 
        const totalPagado = (r.payments || [])
            .filter(p => p.status === 'confirmado')
            .reduce((s, p) => s + p.amount, 0); 
        const saldo = r.valorTotal - totalPagado; 
        return sum + (saldo > 0 ? saldo : 0); 
    }, 0);

    const accountData = METODOS_DE_PAGO.map(metodo => [metodo, formatCurrency(accountBalances[metodo])]);
    accountData.push(['Cartera Total Pendiente', formatCurrency(totalCartera)]);

    if(doc.autoTable) {
        doc.autoTable({ startY: doc.lastAutoTable ? doc.lastAutoTable.finalY + 10 : 150, head: [['Saldos y Totales Actuales', 'Valor']], body: accountData, theme: 'grid', headStyles: { fillColor: [41, 128, 185] } });
    }

    doc.save(`Reporte-Financiero-${startYear}-${startMonth + 1}_a_${endYear}-${endMonth + 1}.pdf`);
}

// --- ESCUCHADORES DE EVENTOS EN TIEMPO REAL ---
document.addEventListener('remisionesChanged', () => {
    const isDashboardOpen = document.getElementById('close-dashboard-modal');
    if (isDashboardOpen) {
        renderCartera();
        renderCarteraClientes();
        renderTopClientes();
        const monthSelect = document.getElementById('summary-month');
        const yearSelect = document.getElementById('summary-year');
        if (monthSelect && yearSelect) {
            updateDashboard(parseInt(yearSelect.value), parseInt(monthSelect.value));
        }
    }
});

document.addEventListener('gastosChanged', () => {
    const isDashboardOpen = document.getElementById('close-dashboard-modal');
    if (isDashboardOpen) {
        const monthSelect = document.getElementById('summary-month');
        const yearSelect = document.getElementById('summary-year');
        if (monthSelect && yearSelect) {
            updateDashboard(parseInt(yearSelect.value), parseInt(monthSelect.value));
        }
    }
});