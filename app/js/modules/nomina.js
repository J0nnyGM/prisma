import { 
    allUsers, allPendingLoans, setAllPendingLoans, 
    currentUser, currentUserData, 
    showModalMessage, hideModal, showTemporaryMessage, showPdfModal 
} from '../app.js';
import { formatCurrency, unformatCurrency, unformatCurrencyInput, formatCurrencyInput } from '../utils.js';
import { METODOS_DE_PAGO } from '../constants.js';
import { db } from '../firebase-config.js';
import { 
    doc, getDoc, collection, query, where, getDocs, orderBy, limit, 
    onSnapshot, addDoc, serverTimestamp, deleteDoc, writeBatch, 
    collectionGroup, updateDoc, arrayUnion 
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

// --- ESTADO LOCAL DEL MÓDULO ---
let activeNominaSubTab = 'nomina_quincenal';
let selectedNominaMonthYear = '';
let currentDrillDownUserId = null;
let currentDrillDownSubTab = 'nomina';
let unsubscribeNominaGlobal = null;
let unsubscribeLoansTab = null;
let unsubscribeMyLoans = null; // para compatibilidad por si se requiere
let activeDetailListeners = [];

// Formateador de moneda colombiana
const currencyFormatter = new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
});

// Asegurarse de que XLSX esté disponible para exportar
window.ensureXLSX = async function() {
    if (window.XLSX) return window.XLSX;
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = "https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js";
        script.onload = () => resolve(window.XLSX);
        script.onerror = () => reject(new Error("No se pudo cargar la librería XLSX"));
        document.head.appendChild(script);
    });
};

// ==========================================
// 1. UTILIDADES DE TIEMPO Y BASES LABORALES
// ==========================================

function calculateDays360(startDate, endDate) {
    if (!startDate || !endDate) return 0;
    const start = new Date(startDate);
    const end = new Date(endDate);
    let day1 = start.getDate();
    let month1 = start.getMonth();
    let year1 = start.getFullYear();
    let day2 = end.getDate();
    let month2 = end.getMonth();
    let year2 = end.getFullYear();

    if (day1 === 31) day1 = 30;
    if (day2 === 31) day2 = 30;

    const isEndFeb = (month2 === 1) && (day2 === 28 || day2 === 29);
    if (isEndFeb) {
        day2 = 30;
    }

    const days = ((year2 - year1) * 360) + ((month2 - month1) * 30) + (day2 - day1) + 1;
    return Math.max(0, days);
}

function getQuincenaDateRange(activeQuincena, selectedMonthYear) {
    if (!selectedMonthYear) return null;
    const [year, month] = selectedMonthYear.split('-').map(Number);
    const isFirst = activeQuincena.toLowerCase().includes('primera');
    const startDay = isFirst ? 1 : 16;
    const endDay = isFirst ? 15 : new Date(year, month, 0).getDate();
    return {
        startDate: new Date(year, month - 1, startDay),
        endDate: new Date(year, month - 1, endDay)
    };
}

function getQuincenaPeriodFromConcept(concept) {
    if (!concept) return null;
    const months = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    const yearMatch = concept.match(/\b\d{4}\b/);
    if (!yearMatch) return null;
    const year = parseInt(yearMatch[0]);
    let monthIndex = -1;
    for (let i = 0; i < months.length; i++) {
        if (concept.toLowerCase().includes(months[i].toLowerCase())) {
            monthIndex = i;
            break;
        }
    }
    if (monthIndex === -1) return null;
    const isFirst = concept.toLowerCase().includes('primera');
    const isSecond = concept.toLowerCase().includes('segunda');
    let startDay = 1;
    let endDay = 30;
    if (isFirst) {
        startDay = 1;
        endDay = 15;
    } else if (isSecond) {
        startDay = 16;
        endDay = new Date(year, monthIndex + 1, 0).getDate();
    } else {
        startDay = 1;
        endDay = new Date(year, monthIndex + 1, 0).getDate();
    }
    return {
        startDate: new Date(year, monthIndex, startDay),
        endDate: new Date(year, monthIndex, endDay)
    };
}

function getIncapacitatedDaysInPeriod(emp, startDate, endDate) {
    if (!emp.incapacitado) return 0;
    if (!emp.incapacidadStart || !emp.incapacidadDays) return 15;
    const incStart = new Date(emp.incapacidadStart + 'T00:00:00');
    const incEnd = new Date(incStart);
    incEnd.setDate(incStart.getDate() + emp.incapacidadDays - 1);
    let count = 0;
    const current = new Date(startDate);
    while (current <= endDate) {
        current.setHours(0,0,0,0);
        const start = new Date(incStart);
        start.setHours(0,0,0,0);
        const end = new Date(incEnd);
        end.setHours(0,0,0,0);
        if (current >= start && current <= end) {
            count++;
        }
        current.setDate(current.getDate() + 1);
    }
    return count;
}

function getEmployeeStartDate(user) {
    if (!user) return new Date();
    if (user.contratacion?.fechaIngreso) return new Date(user.contratacion.fechaIngreso + 'T00:00:00');
    if (user.contractStartDate) return new Date(user.contractStartDate + 'T00:00:00');
    if (user.contractDate) return new Date(user.contractDate + 'T00:00:00');
    if (user.fechaIngreso) return new Date(user.fechaIngreso + 'T00:00:00');
    if (user.creadoEn) {
        if (typeof user.creadoEn.toDate === 'function') return user.creadoEn.toDate();
        return new Date(user.creadoEn);
    }
    return new Date();
}

function getNextPeriodSuggestion(lastConcept) {
    if (!lastConcept) return null;
    const months = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    const yearMatch = lastConcept.match(/\b\d{4}\b/);
    if (!yearMatch) return null;
    let year = parseInt(yearMatch[0]);
    let monthIndex = -1;
    for (let i = 0; i < months.length; i++) {
        if (lastConcept.toLowerCase().includes(months[i].toLowerCase())) {
            monthIndex = i;
            break;
        }
    }
    if (monthIndex === -1) return null;
    const isFirst = lastConcept.toLowerCase().includes('primera');
    const isSecond = lastConcept.toLowerCase().includes('segunda');
    if (isFirst) {
        return `Segunda Quincena de ${months[monthIndex]} ${year}`;
    } else if (isSecond) {
        let nextMonthIndex = monthIndex + 1;
        if (nextMonthIndex > 11) {
            nextMonthIndex = 0;
            year += 1;
        }
        return `Primera Quincena de ${months[nextMonthIndex]} ${year}`;
    }
    return null;
}

function calculateBaseForBenefits(user) {
    const config = getPayrollConfig();
    const minWage = config.salarioMinimo;
    const aux = config.auxilioTransporte;
    if (user.deduccionSobreMinimo === true || user.deduccionSobreMinimo === 'true') {
        return { value: minWage + aux, isMinimum: true, label: 'Salario Mínimo + Aux. Transporte' };
    }
    let base = parseFloat(user.contratacion?.salario) || parseFloat(user.salarioBasico) || 0;
    if (base <= (minWage * 2)) {
        return { value: base + aux, isMinimum: false, label: 'Salario Básico + Aux. Transporte' };
    }
    return { value: base, isMinimum: false, label: 'Salario Básico (Sin Auxilio)' };
}

function calculateIndemnificationValue(type, startDate, endDate, contractEndDate, salary) {
    if (!startDate || !endDate || !salary) return 0;
    const start = new Date(startDate); start.setHours(0,0,0,0);
    const end = new Date(endDate); end.setHours(0,0,0,0);
    const daysWorked = calculateDays360(start, end);
    if (daysWorked <= 0) return 0;

    if (type === 'fijo') {
        if (!contractEndDate) return 0;
        const pactadoEnd = new Date(contractEndDate); pactadoEnd.setHours(0,0,0,0);
        if (end >= pactadoEnd) return 0;
        const daysRemaining = calculateDays360(end, pactadoEnd) - 1;
        return (salary / 30) * daysRemaining;
    }

    if (type === 'indefinido') {
        let indemnizacionDias = 0;
        if (daysWorked <= 360) {
            indemnizacionDias = (30 * daysWorked) / 360;
        } else {
            indemnizacionDias = 30; // Primer año
            const daysRemaining = daysWorked - 360;
            indemnizacionDias += (20 * daysRemaining) / 360;
        }
        return (salary / 30) * indemnizacionDias;
    }
    return 0;
}

let payrollConfig = {
    salarioMinimo: 1300000,
    auxilioTransporte: 249095,
    porcentajeSalud: 4,
    porcentajePension: 4,
    multiplicadorHoraExtra: 1.25
};
let unsubscribePayrollConfig = null;

export function getPayrollConfig() {
    if (!unsubscribePayrollConfig && currentUser) {
        try {
            unsubscribePayrollConfig = onSnapshot(doc(db, "config", "payroll"), (snapshot) => {
                if (snapshot.exists()) {
                    const data = snapshot.data();
                    payrollConfig = {
                        salarioMinimo: parseFloat(data.salarioMinimo) || 1300000,
                        auxilioTransporte: parseFloat(data.auxilioTransporte) || 249095,
                        porcentajeSalud: parseFloat(data.porcentajeSalud) || 4,
                        porcentajePension: parseFloat(data.porcentajePension) || 4,
                        multiplicadorHoraExtra: parseFloat(data.multiplicadorHoraExtra) || 1.25
                    };
                }
            }, (error) => {
                // Silenciamos advertencias de autenticación o permisos temporales
            });
        } catch (e) {
            console.error("Error setting up payroll config listener:", e);
        }
    }
    return payrollConfig;
}

function getUsersMap() {
    const newMap = new Map();
    allUsers.forEach(user => {
        const normalizedUser = { ...user };
        if (!normalizedUser.firstName && !normalizedUser.lastName && normalizedUser.nombre) {
            const parts = normalizedUser.nombre.trim().split(/\s+/);
            normalizedUser.firstName = parts[0] || '';
            normalizedUser.lastName = parts.slice(1).join(' ') || '';
        }
        newMap.set(user.id, normalizedUser);
    });
    return newMap;
}

function getCurrentActiveQuincena(selectedMonthYear) {
    if (!selectedMonthYear) return '';
    const months = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    const [year, month] = selectedMonthYear.split('-').map(Number);
    const foundMonth = months[month - 1];
    const today = new Date();
    const day = today.getDate();
    const q = day > 15 ? 'Segunda Quincena de' : 'Primera Quincena de';
    return `${q} ${foundMonth} ${year}`;
}

function getBankCode(bankName) {
    if (!bankName) return "507";
    const name = bankName.toLowerCase();
    if (name.includes('bancolombia')) return "507";
    if (name.includes('bogota') || name.includes('bogotá')) return "501";
    if (name.includes('davivienda')) return "551";
    if (name.includes('bbva')) return "513";
    if (name.includes('popular')) return "502";
    if (name.includes('occidente')) return "523";
    if (name.includes('caja social')) return "532";
    if (name.includes('itau') || name.includes('itaú')) return "506";
    if (name.includes('nequi')) return "507";
    if (name.includes('daviplata')) return "551";
    return "507";
}

function getProductType(bankName) {
    if (!bankName) return "S";
    const name = bankName.toLowerCase();
    if (name.includes('nequi') || name.includes('daviplata') || name.includes('ahorros') || name.includes('ahorro')) {
        return "A";
    }
    if (name.includes('corriente')) {
        return "C";
    }
    return "A";
}

function cleanTextForBank(text) {
    if (!text) return "";
    return text.toString()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9\s]/g, "")
        .trim();
}

function formatDescription(quincenaConcept) {
    if (!quincenaConcept) return "NOMINA";
    return quincenaConcept.toUpperCase();
}

function setupCurrencyInput(input) {
    if (!input) return;
    input.addEventListener('focus', (e) => unformatCurrencyInput(e.target));
    input.addEventListener('blur', (e) => formatCurrencyInput(e.target));
    if (input.value) {
        formatCurrencyInput(input);
    }
}

// ==========================================
// 2. CARGA PRINCIPAL DEL MÓDULO (LIVE SYNC)
// ==========================================

export function loadNomina() {
    console.log("Suscripción de datos en tiempo real de nómina y préstamos.");
    if (!selectedNominaMonthYear) {
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        selectedNominaMonthYear = `${year}-${month}`;
    }
    renderNominaSkeleton();
    switchNominaSubTab(activeNominaSubTab);
    return () => {
        cleanupNominaListeners();
    };
}

export function setupNominaEvents() {
    const tabNominaBtn = document.getElementById('tab-nomina');
    if (tabNominaBtn) {
        tabNominaBtn.addEventListener('click', () => {
            renderNominaSkeleton();
            switchNominaSubTab(activeNominaSubTab);
        });
    }
    const mobileTabNominaBtn = document.getElementById('mobile-tab-nomina');
    if (mobileTabNominaBtn) {
        mobileTabNominaBtn.addEventListener('click', () => {
            renderNominaSkeleton();
            switchNominaSubTab(activeNominaSubTab);
        });
    }
}

export function cleanupNominaListeners() {
    if (unsubscribeNominaGlobal) {
        unsubscribeNominaGlobal();
        unsubscribeNominaGlobal = null;
    }
    if (unsubscribeLoansTab) {
        unsubscribeLoansTab();
        unsubscribeLoansTab = null;
    }
    if (unsubscribePayrollConfig) {
        unsubscribePayrollConfig();
        unsubscribePayrollConfig = null;
    }
    cleanupActiveDetailListeners();
}

function cleanupActiveDetailListeners() {
    activeDetailListeners.forEach(unsub => {
        if (typeof unsub === 'function') unsub();
    });
    activeDetailListeners = [];
}

// ==========================================
// 3. RENDERIZACIÓN DE VISTAS (ESQUELETO Y SUB-TABS)
// ==========================================

function renderNominaSkeleton() {
    const viewContainer = document.getElementById('view-nomina');
    if (!viewContainer) return;

    viewContainer.innerHTML = `
        <div class="max-w-7xl mx-auto space-y-6">
            <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4 pb-4 border-b border-slate-100">
                <div>
                    <h1 class="text-3xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
                        <span class="p-2 rounded-xl bg-gradient-to-tr from-indigo-500 to-blue-500 text-white shadow-md">
                            <i class="fa-solid fa-money-check-dollar"></i>
                        </span>
                        Gestión de Nómina y Prestaciones
                    </h1>
                    <p class="text-xs font-semibold text-slate-400 mt-1">Cálculo contable, prestaciones sociales colombianas, liquidación de contratos y deudas de RRHH.</p>
                </div>
                <div class="flex items-center gap-2.5 bg-white p-2 rounded-xl border border-slate-200 shadow-sm shrink-0">
                    <label for="nomina-month-selector" class="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none">Mes Contable</label>
                    <input type="month" id="nomina-month-selector" value="${selectedNominaMonthYear}" 
                        class="border-0 p-0 text-sm font-bold text-slate-800 focus:ring-0 cursor-pointer outline-none w-32">
                </div>
            </div>
            
            <div class="bg-white rounded-xl shadow-sm border border-slate-200 p-1.5 overflow-hidden">
                <nav id="nomina-subtabs-nav" class="flex flex-wrap md:flex-nowrap gap-1">
                    <button data-tab="nomina_quincenal" class="nomina-subtab-btn flex-1 py-3 px-4 rounded-lg font-bold text-xs uppercase tracking-wider text-center transition-all duration-200 flex items-center justify-center gap-2">
                        <i class="fa-solid fa-money-bill-wave text-base"></i> Nómina Quincenal
                    </button>
                    <button data-tab="gestion_prestamos" class="nomina-subtab-btn flex-1 py-3 px-4 rounded-lg font-bold text-xs uppercase tracking-wider text-center transition-all duration-200 flex items-center justify-center gap-2 relative">
                        <i class="fa-solid fa-hand-holding-dollar text-base"></i> Gestión de Préstamos
                        <span id="nomina-loan-badge" class="hidden absolute -top-1 -right-1 bg-red-500 text-white text-[9px] font-black rounded-full h-5 w-5 flex items-center justify-center border-2 border-white shadow-sm"></span>
                    </button>
                    <button data-tab="historial_pagos" class="nomina-subtab-btn flex-1 py-3 px-4 rounded-lg font-bold text-xs uppercase tracking-wider text-center transition-all duration-200 flex items-center justify-center gap-2">
                        <i class="fa-solid fa-clock-rotate-left text-base"></i> Historial Global
                    </button>
                </nav>
            </div>

            <div id="nomina-dynamic-content" class="transition-all duration-300"></div>
        </div>
    `;

    const monthSelector = document.getElementById('nomina-month-selector');
    monthSelector.addEventListener('change', (e) => {
        selectedNominaMonthYear = e.target.value;
        if (currentDrillDownUserId) {
            loadIndividualDashboard(currentDrillDownUserId, currentDrillDownSubTab);
        } else {
            renderActiveSubTab();
        }
    });

    const subTabNav = document.getElementById('nomina-subtabs-nav');
    subTabNav.addEventListener('click', (e) => {
        const btn = e.target.closest('.nomina-subtab-btn');
        if (btn && !btn.classList.contains('active')) {
            currentDrillDownUserId = null;
            switchNominaSubTab(btn.dataset.tab);
        }
    });

    updateLoanBadge();
}

function switchNominaSubTab(tabName) {
    activeNominaSubTab = tabName;
    const nav = document.getElementById('nomina-subtabs-nav');
    if (nav) {
        nav.querySelectorAll('.nomina-subtab-btn').forEach(btn => {
            const isActive = btn.dataset.tab === tabName;
            if (isActive) {
                btn.className = "nomina-subtab-btn active flex-1 py-3 px-4 rounded-lg font-bold text-xs uppercase tracking-wider text-center transition-all duration-200 flex items-center justify-center gap-2 bg-gradient-to-tr from-[#e67817] to-amber-500 text-white shadow-sm";
            } else {
                btn.className = "nomina-subtab-btn flex-1 py-3 px-4 rounded-lg font-bold text-xs uppercase tracking-wider text-center transition-all duration-200 flex items-center justify-center gap-2 text-slate-500 hover:text-slate-800 hover:bg-slate-50";
            }
        });
    }
    renderActiveSubTab();
}

function renderActiveSubTab() {
    const dynamicContent = document.getElementById('nomina-dynamic-content');
    if (!dynamicContent) return;

    if (unsubscribeLoansTab) {
        unsubscribeLoansTab();
        unsubscribeLoansTab = null;
    }

    switch (activeNominaSubTab) {
        case 'nomina_quincenal':
            loadNominaQuincenalTab(dynamicContent);
            break;
        case 'prestaciones_sociales':
            loadPrestacionesTab(dynamicContent);
            break;
        case 'liquidacion_contrato':
            loadLiquidacionesTab(dynamicContent);
            break;
        case 'gestion_prestamos':
            loadGestionPrestamosTab(dynamicContent);
            break;
        case 'historial_pagos':
            loadGlobalHistoryTab(dynamicContent);
            break;
    }
}

function updateLoanBadge() {
    const badge = document.getElementById('nomina-loan-badge');
    const headerBadge = document.getElementById('header-loan-badge');
    if (badge) {
        if (allPendingLoans.length > 0) {
            badge.textContent = allPendingLoans.length;
            badge.classList.remove('hidden');
        } else {
            badge.classList.add('hidden');
        }
    }
    if (headerBadge) {
        if (allPendingLoans.length > 0) {
            headerBadge.textContent = allPendingLoans.length;
            headerBadge.classList.remove('hidden');
        } else {
            headerBadge.classList.add('hidden');
        }
    }
}

// ==========================================
// 4. SUB-TAB 1: NÓMINA QUINCENAL
// ==========================================

async function loadNominaQuincenalTab(container) {
    container.innerHTML = `
        <div class="space-y-6">
            <div id="nomina-kpi-container" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <div class="bg-white p-4 rounded-xl shadow-sm border border-gray-150 animate-pulse h-24"></div>
                <div class="bg-white p-4 rounded-xl shadow-sm border border-gray-150 animate-pulse h-24"></div>
                <div class="bg-white p-4 rounded-xl shadow-sm border border-gray-150 animate-pulse h-24"></div>
            </div>

            <div class="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 space-y-6">
                <div class="flex flex-col md:flex-row justify-between items-center gap-4 pb-4 border-b border-slate-100">
                    <div class="flex items-center gap-3 w-full md:w-auto">
                        <h3 class="text-lg font-bold text-slate-800 flex items-center gap-2">
                            Previsualización General
                            <span id="nomina-active-quincena-badge" class="text-[10px] font-black bg-indigo-50 text-indigo-650 border border-indigo-100 px-2.5 py-0.5 rounded-full uppercase tracking-wider">Cargando...</span>
                        </h3>
                    </div>
                    
                    <div class="flex flex-col sm:flex-row gap-3 w-full md:w-auto items-stretch sm:items-center">
                        <label class="flex items-center gap-2 bg-slate-50 px-3 py-2 rounded-xl border border-slate-200 cursor-pointer hover:bg-slate-100 transition-colors h-[42px] shrink-0">
                            <input type="checkbox" id="toggle-apply-loans" checked class="w-4 h-4 text-[#e67817] rounded focus:ring-amber-500 border-slate-350 cursor-pointer">
                            <span class="text-xs font-bold text-slate-600 select-none">Aplicar Préstamos</span>
                        </label>

                        <div class="relative flex-grow group">
                            <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400 group-focus-within:text-[#e67817] transition-colors">
                                <i class="fa-solid fa-magnifying-glass"></i>
                            </div>
                            <input type="text" id="nomina-search" 
                                class="pl-10 pr-4 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-[#e67817] focus:border-[#e67817] w-full md:w-56 transition-all outline-none bg-slate-50/50 hover:bg-white focus:bg-white h-[42px]" 
                                placeholder="Buscar colaborador...">
                        </div>
                        
                        <button id="btn-export-nomina-excel" class="bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2 px-4 rounded-xl shadow-xs transition-all flex items-center justify-center gap-2 text-sm h-[42px] shrink-0">
                            <i class="fa-solid fa-file-excel"></i> Exportar Lote
                        </button>
                    </div>
                </div>

                <div class="overflow-hidden rounded-xl border border-slate-200 shadow-xs">
                    <div class="overflow-x-auto">
                        <table class="w-full text-sm text-left" id="nomina-table">
                            <thead class="text-xs text-slate-400 uppercase bg-slate-50/70 border-b border-slate-250">
                                <tr>
                                    <th class="px-6 py-4 font-black tracking-wider">Colaborador</th>
                                    <th class="px-6 py-4 font-black tracking-wider text-right">Básico + Aux (15d)</th>
                                    <th class="px-6 py-4 font-black tracking-wider text-right text-rose-600">Deducciones Ley</th>
                                    <th class="px-6 py-4 font-black tracking-wider text-right text-amber-600">Préstamos</th>
                                    <th class="px-6 py-4 font-black tracking-wider text-right text-blue-700">Neto Quincenal</th>
                                    <th class="px-6 py-4 font-black tracking-wider text-center">Acciones</th>
                                </tr>
                            </thead>
                            <tbody id="empleados-nomina-table-body" class="divide-y divide-slate-100">
                                <tr><td colspan="7" class="text-center py-12"><div class="loader mx-auto mb-2"></div><p class="text-xs text-gray-400">Calculando nómina...</p></td></tr>
                            </tbody>
                        </table>
                    </div>
                </div>
                
                <div class="flex items-center gap-2 text-[10px] text-slate-400 bg-slate-50 p-3 rounded-xl border border-slate-100/50">
                    <i class="fa-solid fa-circle-info text-blue-500 text-sm"></i>
                    <p class="leading-relaxed"><strong>Nota de Préstamos:</strong> Las deudas aquí mostradas son sugerencias proporcionales. El valor final amortizado de la deuda se asienta automáticamente al confirmar y exportar en lote o registrar el pago individual.</p>
                </div>
            </div>
        </div>
    `;

    const tableBody = document.getElementById('empleados-nomina-table-body');
    const kpiContainer = document.getElementById('nomina-kpi-container');
    const searchInput = document.getElementById('nomina-search');
    const exportBtn = document.getElementById('btn-export-nomina-excel');
    const toggleLoans = document.getElementById('toggle-apply-loans');

    const activeQuincena = getCurrentActiveQuincena(selectedNominaMonthYear);
    const badgeEl = document.getElementById('nomina-active-quincena-badge');
    if (badgeEl) badgeEl.textContent = activeQuincena;

    const currentStatDocId = selectedNominaMonthYear.replace('-', '_');

    try {
        const usersMap = getUsersMap();
        const activeUsers = [];
        usersMap.forEach((user, id) => {
            const basico = parseFloat(user.contratacion?.salario) || parseFloat(user.salarioBasico) || 0;
            if (user.status === 'active' && (user.role || '').toLowerCase().trim() !== 'facturador' && basico > 0) {
                activeUsers.push({ id, ...user });
            }
        });

        if (activeUsers.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="6" class="text-center py-10 text-slate-500 font-bold">No se encontraron operarios activos en el sistema.</td></tr>`;
            kpiContainer.innerHTML = '';
            return;
        }

        const loansQuery = query(collectionGroup(db, 'loans'), where('status', '==', 'active'));
        const loansSnapshot = await getDocs(loansQuery);

        if (!document.getElementById('nomina-table')) return;

        const userLoansMap = new Map();
        loansSnapshot.forEach(docSnap => {
            const loan = docSnap.data();
            const userId = docSnap.ref.parent.parent.id;
            if (!userLoansMap.has(userId)) {
                userLoansMap.set(userId, { totalBalance: 0, estimatedDeduction: 0, loans: [] });
            }
            const userData = userLoansMap.get(userId);
            userData.totalBalance += (loan.balance || 0);
            
            const installments = loan.installments > 0 ? loan.installments : 1;
            let suggestedInstallment = (loan.amount || 0) / installments;
            if (suggestedInstallment > (loan.balance || 0)) {
                suggestedInstallment = (loan.balance || 0);
            }
            userData.estimatedDeduction += suggestedInstallment;
            userData.loans.push({ id: docSnap.id, ...loan });
        });

        const paymentsQuery = query(
            collectionGroup(db, 'paymentHistory'),
            where('concepto', '==', activeQuincena)
        );

        const statPromises = activeUsers.map(op => getDoc(doc(db, "employeeStats", op.id, "monthlyStats", currentStatDocId)));

        const [statSnapshots, paymentsSnapshot] = await Promise.all([
            Promise.all(statPromises),
            getDocs(paymentsQuery).catch(err => {
                console.error("Error consultando pagos duplicados:", err);
                return { empty: true };
            })
        ]);

        if (!document.getElementById('nomina-table')) return;

        let paidEmployeeIds = new Set();
        if (paymentsSnapshot && !paymentsSnapshot.empty) {
            paymentsSnapshot.forEach(docSnap => {
                const userId = docSnap.ref.parent.parent.id;
                paidEmployeeIds.add(userId);
            });
        }

        const rawEmpleadoData = activeUsers.map((operario, index) => {
            const statDoc = statSnapshots[index];
            const stats = statDoc.exists() ? statDoc.data() : { totalBonificacion: 0 };
            const loanInfo = userLoansMap.get(operario.id) || { totalBalance: 0, estimatedDeduction: 0, loans: [] };

            const basico = parseFloat(operario.contratacion?.salario) || parseFloat(operario.salarioBasico) || 0;
            const bono = 0;
            const deductionPotential = Math.min(loanInfo.estimatedDeduction, loanInfo.totalBalance);
            const dedSobreMinimo = operario.deduccionSobreMinimo === true || operario.deduccionSobreMinimo === 'true';

            return {
                id: operario.id,
                fullName: `${operario.firstName} ${operario.lastName}`,
                firstName: operario.firstName || '',
                lastName: operario.lastName || '',
                email: operario.email || '',
                initials: ((operario.firstName ? operario.firstName[0] : '') + (operario.lastName ? operario.lastName[0] : 'E')).toUpperCase(),
                cedula: operario.idNumber || 'N/A',
                bankName: operario.bankName || 'N/A',
                accountNumber: operario.accountNumber || 'N/A',
                commissionLevel: operario.commissionLevel || 'principiante',
                role: operario.role || 'operario',
                salarioBasico: basico,
                bonificacion: bono,
                deduccionPotencial: deductionPotential,
                deudaTotal: loanInfo.totalBalance,
                loansList: loanInfo.loans,
                deduccionSobreMinimo: dedSobreMinimo,
                incapacitado: operario.incapacitado || false,
                incapacidadStart: operario.incapacidadStart || null,
                incapacidadDays: operario.incapacidadDays || 0
            };
        });

        const updateView = () => {
            const applyLoans = toggleLoans.checked;
            const searchTerm = searchInput.value.toLowerCase();
            const config = getPayrollConfig();
            const diasPagar = 15;

            const processedData = rawEmpleadoData.map(emp => {
                const salarioProrrateado = (emp.salarioBasico / 30) * diasPagar;
                const auxTransporteMensual = emp.salarioBasico <= (config.salarioMinimo * 2) ? config.auxilioTransporte : 0;

                let incDays = 0;
                const range = getQuincenaDateRange(activeQuincena, selectedNominaMonthYear);
                if (range) {
                    incDays = getIncapacitatedDaysInPeriod(emp, range.startDate, range.endDate);
                } else if (emp.incapacitado) {
                    incDays = diasPagar;
                }
                const diasAuxTransporte = Math.max(0, diasPagar - incDays);
                const auxTransporteProrrateado = (auxTransporteMensual / 30) * diasAuxTransporte;

                let baseDeduccion = 0;
                if (emp.deduccionSobreMinimo) {
                    baseDeduccion = (config.salarioMinimo / 30) * diasPagar;
                } else {
                    baseDeduccion = salarioProrrateado + emp.bonificacion;
                }

                if (baseDeduccion > 0 && baseDeduccion < (config.salarioMinimo / 30) * diasPagar) {
                    baseDeduccion = (config.salarioMinimo / 30) * diasPagar;
                }

                const deduccionSalud = baseDeduccion * (config.porcentajeSalud / 100);
                const deduccionPension = baseDeduccion * (config.porcentajePension / 100);
                const totalDeduccionesLey = deduccionSalud + deduccionPension;
                const deduccionPrestamos = applyLoans ? emp.deduccionPotencial : 0;

                const totalDevengado = salarioProrrateado + auxTransporteProrrateado + emp.bonificacion;
                const originalTotalPagar = Math.max(0, totalDevengado - totalDeduccionesLey - deduccionPrestamos);
                const isAlreadyPaid = paidEmployeeIds.has(emp.id);
                const totalPagar = isAlreadyPaid ? 0 : originalTotalPagar;

                return {
                    ...emp,
                    salarioProrrateado,
                    auxTransporteProrrateado,
                    totalDeduccionesLey,
                    deduccionPrestamos,
                    originalTotalPagar,
                    isAlreadyPaid,
                    totalPagar
                };
            });

            const filteredData = processedData.filter(emp =>
                emp.fullName.toLowerCase().includes(searchTerm) ||
                emp.cedula.includes(searchTerm)
            );

            const roleOrder = {
                'planta': 1,
                'admin': 2
            };
            filteredData.sort((a, b) => {
                const orderA = roleOrder[(a.role || '').toLowerCase().trim()] || 99;
                const orderB = roleOrder[(b.role || '').toLowerCase().trim()] || 99;
                if (orderA !== orderB) {
                    return orderA - orderB;
                }
                return (a.fullName || '').localeCompare(b.fullName || '', 'es');
            });

            let sumBasico = 0, sumBonificacion = 0, sumDeducciones = 0, sumTotal = 0;
            processedData.forEach(p => {
                sumBasico += p.salarioProrrateado;
                sumBonificacion += p.bonificacion;
                sumDeducciones += p.totalDeduccionesLey + p.deduccionPrestamos;
                sumTotal += p.totalPagar;
            });

            kpiContainer.innerHTML = `
                <div class="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex items-center gap-4">
                    <div class="w-12 h-12 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center text-xl shadow-xs"><i class="fa-solid fa-money-bill-wave"></i></div>
                    <div>
                        <p class="text-[9px] font-black text-slate-400 uppercase tracking-wider leading-none mb-1">Nómina Quincenal Estimada</p>
                        <h3 class="text-lg font-black text-slate-800">${currencyFormatter.format(sumTotal)}</h3>
                    </div>
                </div>
                <div class="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex items-center gap-4">
                    <div class="w-12 h-12 rounded-xl bg-red-50 text-red-600 flex items-center justify-center text-xl shadow-xs"><i class="fa-solid fa-hand-holding-dollar"></i></div>
                    <div>
                        <p class="text-[9px] font-black text-slate-400 uppercase tracking-wider leading-none mb-1">Deducciones Aplicadas</p>
                        <h3 class="text-lg font-black text-red-600">- ${currencyFormatter.format(sumDeducciones)}</h3>
                    </div>
                </div>
                <div class="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex items-center gap-4">
                    <div class="w-12 h-12 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center text-xl shadow-xs"><i class="fa-solid fa-users"></i></div>
                    <div>
                        <p class="text-[9px] font-black text-slate-400 uppercase tracking-wider leading-none mb-1">Colaboradores Activos</p>
                        <h3 class="text-lg font-black text-slate-800">${activeUsers.length}</h3>
                    </div>
                </div>
            `;

            tableBody.innerHTML = '';
            if (filteredData.length === 0) {
                tableBody.innerHTML = `<tr><td colspan="6" class="text-center py-10 text-slate-500 font-bold">No se encontraron resultados.</td></tr>`;
                return;
            }

            filteredData.forEach(data => {
                const row = document.createElement('tr');
                row.className = 'bg-white hover:bg-slate-50/75 cursor-pointer transition-colors border-b border-slate-100 last:border-0 group';
                
                const leyHtml = data.totalDeduccionesLey > 0 
                    ? `<span class="text-rose-600 font-bold bg-rose-50 px-2 py-0.5 rounded border border-rose-100 font-mono">-${currencyFormatter.format(data.totalDeduccionesLey)}</span>`
                    : `<span class="text-gray-300">-</span>`;

                let prestamosHtml = `<span class="text-gray-300">-</span>`;
                if (!applyLoans) {
                    if (data.deudaTotal > 0) {
                        prestamosHtml = `<span class="text-amber-600 font-bold bg-amber-50 px-2 py-0.5 rounded border border-amber-100 font-mono" title="Saldo deudor total: ${currencyFormatter.format(data.deudaTotal)}">Saldo: ${currencyFormatter.format(data.deudaTotal)}</span>`;
                    }
                } else {
                    if (data.deduccionPrestamos > 0) {
                        prestamosHtml = `<span class="text-rose-600 font-bold bg-rose-50 px-2 py-0.5 rounded border border-rose-100 font-mono" title="Descuento en esta quincena">-${currencyFormatter.format(data.deduccionPrestamos)}</span>`;
                    }
                }

                const basicoMasAux = data.salarioProrrateado + data.auxTransporteProrrateado;

                let netPayHtml = `<span class="font-black text-blue-700 text-sm md:text-base font-mono">${currencyFormatter.format(data.totalPagar)}</span>`;
                if (data.isAlreadyPaid) {
                    netPayHtml = `
                        <div class="flex flex-col items-end">
                            <span class="font-black text-slate-450 text-xs line-through font-mono">${currencyFormatter.format(data.originalTotalPagar)}</span>
                            <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[9px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-100 mt-1 shadow-xs">
                                <i class="fa-solid fa-circle-check"></i> CONFIRMADO
                            </span>
                        </div>
                    `;
                }

                const range = getQuincenaDateRange(activeQuincena, selectedNominaMonthYear);
                const isIncapacitatedInPeriod = range ? getIncapacitatedDaysInPeriod(data, range.startDate, range.endDate) > 0 : data.incapacitado;
                const incapacitadoBadge = isIncapacitatedInPeriod ? ' <span class="text-rose-600 font-extrabold bg-rose-50 px-1 py-0.5 rounded border border-rose-100 text-[8px] ml-1 shadow-xs"><i class="fa-solid fa-house-medical mr-1"></i>INCAPACITADO</span>' : '';

                row.innerHTML = `
                    <td class="px-6 py-4">
                        <div class="flex items-center gap-3">
                            <div class="w-9 h-9 rounded-full bg-indigo-50 text-indigo-650 flex items-center justify-center text-xs font-bold border border-indigo-100 shrink-0">
                                ${data.initials}
                            </div>
                            <div class="min-w-0">
                                <p class="font-bold text-slate-800 text-sm leading-tight truncate">${data.fullName}</p>
                                <p class="text-[9px] text-slate-400 uppercase font-bold tracking-wider mt-0.5 leading-none">${data.role}${incapacitadoBadge}</p>
                            </div>
                        </div>
                    </td>
                    <td class="px-6 py-4 text-right font-semibold text-slate-600 text-xs md:text-sm font-mono">${currencyFormatter.format(basicoMasAux)}</td>
                    <td class="px-6 py-4 text-right text-xs md:text-sm">${leyHtml}</td>
                    <td class="px-6 py-4 text-right text-xs md:text-sm">${prestamosHtml}</td>
                    <td class="px-6 py-4 text-right">${netPayHtml}</td>
                    <td class="px-6 py-4 text-center">
                        <button class="btn-drill-nomina text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 w-8 h-8 rounded-lg transition-all inline-flex items-center justify-center shadow-xs border border-transparent hover:border-indigo-100" 
                            title="Ver e Ingresar Pago Individual">
                            <i class="fa-solid fa-calculator text-base"></i>
                        </button>
                    </td>
                `;

                row.querySelector('.btn-drill-nomina').addEventListener('click', (e) => {
                    e.stopPropagation();
                    loadIndividualDashboard(data.id, 'nomina');
                });
                
                row.addEventListener('click', () => {
                    loadIndividualDashboard(data.id, 'nomina');
                });

                tableBody.appendChild(row);
            });
        };

        toggleLoans.addEventListener('change', updateView);
        searchInput.addEventListener('input', updateView);

        exportBtn.addEventListener('click', async () => {
            const applyLoans = toggleLoans.checked;
            const config = getPayrollConfig();

            let exportModal = document.getElementById('export-nomina-modal');
            if (!exportModal) {
                exportModal = document.createElement('div');
                exportModal.id = 'export-nomina-modal';
                exportModal.className = 'fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 transition-all opacity-0 pointer-events-none duration-300';
                document.body.appendChild(exportModal);
            }

            exportModal.innerHTML = `
                <div class="bg-white w-full max-w-5xl rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden transform scale-95 transition-all duration-300 border border-slate-200" id="export-nomina-modal-card">
                    <div class="bg-gradient-to-r from-emerald-600 to-teal-600 px-6 py-4 flex justify-between items-center text-white shrink-0">
                        <div class="flex items-center gap-3">
                            <div class="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center text-xl">
                                <i class="fa-solid fa-file-excel"></i>
                            </div>
                            <div>
                                <h3 class="font-extrabold text-base md:text-lg">Exportación de Nómina Bancaria</h3>
                                <p class="text-xs text-emerald-100 font-medium">Formato Bancolombia • <span class="uppercase font-bold">${activeQuincena}</span></p>
                            </div>
                        </div>
                        <button id="btn-close-export-modal" class="text-white/80 hover:text-white transition-colors w-8 h-8 rounded-full hover:bg-white/10 flex items-center justify-center text-xl">&times;</button>
                    </div>

                    <div class="p-6 flex-1 overflow-y-auto bg-slate-50/50 space-y-6">
                        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div class="bg-white p-4 rounded-xl border border-slate-200/60 shadow-xs flex items-center gap-4">
                                <div class="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center text-lg shadow-xs"><i class="fa-solid fa-users"></i></div>
                                <div>
                                    <p class="text-[9px] font-black text-slate-400 uppercase tracking-wider mb-1">A Dispersar</p>
                                    <h4 class="text-base font-black text-slate-800" id="export-total-count">0 operarios</h4>
                                </div>
                            </div>
                            <div class="bg-white p-4 rounded-xl border border-slate-200/60 shadow-xs flex items-center gap-4">
                                <div class="w-10 h-10 rounded-lg bg-indigo-50 text-indigo-650 flex items-center justify-center text-lg shadow-xs"><i class="fa-solid fa-vault"></i></div>
                                <div>
                                    <p class="text-[9px] font-black text-slate-400 uppercase tracking-wider mb-1">Monto Total</p>
                                    <h4 class="text-base font-black text-slate-800 font-mono" id="export-total-amount">$ 0</h4>
                                </div>
                            </div>
                            <div class="bg-gradient-to-br from-emerald-50 to-teal-50/30 border border-emerald-100 p-4 rounded-xl flex items-start gap-3">
                                <i class="fa-solid fa-circle-info text-emerald-600 mt-0.5 text-sm"></i>
                                <p class="text-[11px] text-emerald-850 leading-relaxed">
                                    <strong>Ajustes del Periodo:</strong> Modifique los días de pago/transporte de cada operario. Las deducciones de ley, abonos de préstamos y neto total se recalcularán en tiempo real.
                                </p>
                            </div>
                        </div>

                        <div class="bg-white rounded-xl border border-slate-250 overflow-hidden shadow-xs">
                            <div class="overflow-x-auto">
                                <table class="w-full text-xs text-left" id="export-nomina-table-details">
                                    <thead class="text-[10px] text-slate-400 uppercase bg-slate-50 border-b border-slate-200">
                                        <tr>
                                            <th class="px-4 py-3 text-center w-12">
                                                <input type="checkbox" id="export-select-all" checked class="w-4 h-4 text-emerald-600 rounded border-slate-350 focus:ring-emerald-500 cursor-pointer">
                                            </th>
                                            <th class="px-4 py-3 font-black tracking-wider">Colaborador</th>
                                            <th class="px-4 py-3 font-black tracking-wider text-right">Básico Mensual</th>
                                            <th class="px-4 py-3 font-black tracking-wider text-center w-24">Días Pago</th>
                                            <th class="px-4 py-3 font-black tracking-wider text-center w-24">Días Transp.</th>
                                            <th class="px-4 py-3 font-black tracking-wider text-right text-rose-600">Deducciones</th>
                                            <th class="px-4 py-3 font-black tracking-wider text-right text-blue-700">Neto a Pagar</th>
                                            <th class="px-4 py-3 font-black tracking-wider text-center">Estado</th>
                                        </tr>
                                    </thead>
                                    <tbody class="divide-y divide-slate-100" id="export-nomina-tbody"></tbody>
                                </table>
                            </div>
                        </div>
                    </div>

                    <div class="bg-slate-50 border-t border-slate-200 px-6 py-4 flex justify-between items-center shrink-0">
                        <button type="button" id="btn-cancel-export-modal" class="px-5 py-2.5 rounded-xl border border-slate-250 text-slate-600 font-bold hover:bg-slate-100 transition-colors text-sm">
                            Cancelar
                        </button>
                        <button type="button" id="btn-confirm-export-excel" class="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-750 text-white px-8 py-2.5 rounded-xl font-bold shadow-md hover:shadow-lg transform hover:-translate-y-0.5 transition-all text-sm flex items-center gap-2">
                            <i class="fa-solid fa-file-excel text-base"></i> Confirmar Nómina y Bajar Excel
                        </button>
                    </div>
                </div>
            `;

            const tbody = document.getElementById('export-nomina-tbody');
            const defaultDias = (activeQuincena.includes('Mensual') || activeQuincena.includes('Completo')) ? 30 : 15;

            rawEmpleadoData.forEach(emp => {
                let incDays = 0;
                const range = getQuincenaDateRange(activeQuincena, selectedNominaMonthYear);
                if (range) {
                    incDays = getIncapacitatedDaysInPeriod(emp, range.startDate, range.endDate);
                } else if (emp.incapacitado) {
                    incDays = defaultDias;
                }
                const defaultDiasTransporte = Math.max(0, defaultDias - incDays);
                const salarioProrrateado = (emp.salarioBasico / 30) * defaultDias;
                const auxTransporteMensual = emp.salarioBasico <= (config.salarioMinimo * 2) ? config.auxilioTransporte : 0;
                const auxTransporteProrrateado = (auxTransporteMensual / 30) * defaultDiasTransporte;
                
                let baseDeduccion = 0;
                if (emp.deduccionSobreMinimo) {
                    baseDeduccion = (config.salarioMinimo / 30) * defaultDias;
                } else {
                    baseDeduccion = salarioProrrateado + emp.bonificacion;
                }
                if (baseDeduccion > 0 && baseDeduccion < (config.salarioMinimo / 30) * defaultDias) {
                    baseDeduccion = (config.salarioMinimo / 30) * defaultDias;
                }
                
                const deduccionSalud = baseDeduccion * (config.porcentajeSalud / 100);
                const deduccionPension = baseDeduccion * (config.porcentajePension / 100);
                const totalDeduccionesLey = deduccionSalud + deduccionPension;
                const deduccionPrestamos = applyLoans ? emp.deduccionPotencial : 0;
                
                const totalDevengado = salarioProrrateado + auxTransporteProrrateado + emp.bonificacion;
                const totalPagar = Math.max(0, totalDevengado - totalDeduccionesLey - deduccionPrestamos);
                
                const isPaid = paidEmployeeIds.has(emp.id);

                const row = document.createElement('tr');
                row.className = `hover:bg-slate-50/50 transition-colors ${isPaid ? 'bg-emerald-50/20 text-slate-500' : ''}`;
                row.dataset.id = emp.id;
                row.dataset.diasSalario = defaultDias;
                row.dataset.diasAuxTransporte = defaultDiasTransporte;
                row.dataset.totalPagar = isPaid ? 0 : totalPagar;

                row.innerHTML = `
                    <td class="px-4 py-3 text-center">
                        <input type="checkbox" ${isPaid ? '' : 'checked'} ${isPaid ? 'disabled' : ''} class="export-include-chk w-4 h-4 text-emerald-600 rounded border-slate-350 focus:ring-emerald-500 cursor-pointer">
                    </td>
                    <td class="px-4 py-3 font-bold text-slate-800">
                        <div>
                            <p class="text-xs font-black text-slate-700">${emp.fullName}</p>
                            <p class="text-[9px] text-slate-400 mt-0.5 font-semibold uppercase">${emp.role} • C.C. ${emp.cedula}</p>
                        </div>
                    </td>
                    <td class="px-4 py-3 text-right font-medium text-slate-500 font-mono">${currencyFormatter.format(emp.salarioBasico)}</td>
                    <td class="px-4 py-3 text-center">
                        <input type="number" value="${defaultDias}" min="0" max="30" ${isPaid ? 'disabled' : ''} class="export-days-salario w-14 text-center border border-slate-200 focus:ring-emerald-500 focus:border-emerald-500 rounded-md p-1 font-bold text-slate-700">
                    </td>
                    <td class="px-4 py-3 text-center">
                        <input type="number" value="${defaultDiasTransporte}" min="0" max="30" ${isPaid ? 'disabled' : ''} class="export-days-transport w-14 text-center border border-slate-200 focus:ring-emerald-500 focus:border-emerald-500 rounded-md p-1 font-bold text-slate-700">
                    </td>
                    <td class="px-4 py-3 text-right font-medium text-rose-600 font-mono export-deducciones-display">-${currencyFormatter.format(totalDeduccionesLey + deduccionPrestamos)}</td>
                    <td class="px-4 py-3 text-right font-black text-blue-700 font-mono export-neto-display">${currencyFormatter.format(isPaid ? 0 : totalPagar)}</td>
                    <td class="px-4 py-3 text-center font-bold">
                        ${isPaid 
                            ? `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[9px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200"><i class="fa-solid fa-circle-check"></i> COMPLETO</span>`
                            : `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[9px] font-bold bg-amber-100 text-amber-800 border border-amber-250"><i class="fa-solid fa-clock"></i> PENDIENTE</span>`
                        }
                    </td>
                `;

                const daysSalarioInput = row.querySelector('.export-days-salario');
                const daysTransportInput = row.querySelector('.export-days-transport');
                const includeChk = row.querySelector('.export-include-chk');

                const recalculateRow = () => {
                    if (isPaid) return;
                    const dSalario = parseInt(daysSalarioInput.value) || 0;
                    const dTransport = parseInt(daysTransportInput.value) || 0;
                    
                    const salProrrateado = (emp.salarioBasico / 30) * dSalario;
                    const auxTransMensual = emp.salarioBasico <= (config.salarioMinimo * 2) ? config.auxilioTransporte : 0;
                    const auxTransProrrateado = (auxTransMensual / 30) * dTransport;
                    
                    let baseDed = 0;
                    if (emp.deduccionSobreMinimo) {
                        baseDed = (config.salarioMinimo / 30) * dSalario;
                    } else {
                        baseDed = salProrrateado + emp.bonificacion;
                    }
                    if (baseDed > 0 && baseDed < (config.salarioMinimo / 30) * dSalario) {
                        baseDed = (config.salarioMinimo / 30) * dSalario;
                    }
                    
                    const dedSalud = baseDed * (config.porcentajeSalud / 100);
                    const dedPension = baseDed * (config.porcentajePension / 100);
                    const totalDedLey = dedSalud + dedPension;
                    const dedPrestamos = applyLoans ? emp.deduccionPotencial : 0;
                    
                    const totDevengado = salProrrateado + auxTransProrrateado + emp.bonificacion;
                    const totPagar = Math.max(0, totDevengado - totalDedLey - dedPrestamos);
                    
                    const isIncluded = includeChk.checked;
                    const finalPagar = isIncluded ? totPagar : 0;
                    
                    row.dataset.diasSalario = dSalario;
                    row.dataset.diasAuxTransporte = dTransport;
                    row.dataset.totalPagar = finalPagar;
                    
                    row.querySelector('.export-deducciones-display').textContent = `-${currencyFormatter.format(totalDedLey + dedPrestamos)}`;
                    row.querySelector('.export-neto-display').textContent = currencyFormatter.format(finalPagar);
                    
                    updateExportGrandTotals();
                };

                if (!isPaid) {
                    daysSalarioInput.addEventListener('input', recalculateRow);
                    daysTransportInput.addEventListener('input', recalculateRow);
                    includeChk.addEventListener('change', recalculateRow);
                }

                tbody.appendChild(row);
            });

            const updateExportGrandTotals = () => {
                const rows = tbody.querySelectorAll('tr');
                let includedCount = 0;
                let grandTotal = 0;
                
                rows.forEach(r => {
                    const includeChk = r.querySelector('.export-include-chk');
                    if (includeChk && includeChk.checked) {
                        includedCount++;
                        grandTotal += parseFloat(r.dataset.totalPagar) || 0;
                    }
                });
                
                document.getElementById('export-total-count').textContent = `${includedCount} operario${includedCount !== 1 ? 's' : ''}`;
                document.getElementById('export-total-amount').textContent = currencyFormatter.format(grandTotal);
            };

            updateExportGrandTotals();

            const selectAllChk = document.getElementById('export-select-all');
            selectAllChk.addEventListener('change', () => {
                const chks = tbody.querySelectorAll('.export-include-chk');
                chks.forEach(chk => {
                    if (!chk.disabled) {
                        chk.checked = selectAllChk.checked;
                        chk.dispatchEvent(new Event('change'));
                    }
                });
            });

            const closeModal = () => {
                const card = document.getElementById('export-nomina-modal-card');
                if (card) card.classList.add('scale-95');
                exportModal.classList.add('opacity-0', 'pointer-events-none');
            };

            document.getElementById('btn-close-export-modal').onclick = closeModal;
            document.getElementById('btn-cancel-export-modal').onclick = closeModal;

            document.getElementById('btn-confirm-export-excel').onclick = async () => {
                const rows = tbody.querySelectorAll('tr');
                const exportData = [];
                const batch = writeBatch(db);
                const currentUserId = currentUser.uid;
                const registeredByName = currentUserData.nombre || 'Sistema';
                let hasUpdates = false;

                rows.forEach(r => {
                    const includeChk = r.querySelector('.export-include-chk');
                    if (includeChk && includeChk.checked) {
                        const empId = r.dataset.id;
                        const emp = rawEmpleadoData.find(e => e.id === empId);
                        if (!emp) return;
                        
                        const dSalario = parseInt(r.dataset.diasSalario) || 0;
                        const dTransport = parseInt(r.dataset.diasAuxTransporte) || 0;
                        const finalPagar = parseFloat(r.dataset.totalPagar) || 0;
                        
                        const salarioProrrateado = (emp.salarioBasico / 30) * dSalario;
                        const auxTransporteMensual = emp.salarioBasico <= (config.salarioMinimo * 2) ? config.auxilioTransporte : 0;
                        const auxTransporteProrrateado = (auxTransporteMensual / 30) * dTransport;
                        
                        let baseDeduccion = 0;
                        if (emp.deduccionSobreMinimo) {
                            baseDeduccion = (config.salarioMinimo / 30) * dSalario;
                        } else {
                            baseDeduccion = salarioProrrateado + emp.bonificacion;
                        }
                        if (baseDeduccion > 0 && baseDeduccion < (config.salarioMinimo / 30) * dSalario) {
                            baseDeduccion = (config.salarioMinimo / 30) * dSalario;
                        }
                        
                        const deduccionSalud = baseDeduccion * (config.porcentajeSalud / 100);
                        const deduccionPension = baseDeduccion * (config.porcentajePension / 100);
                        const totalDeduccionesLey = deduccionSalud + deduccionPension;
                        const deduccionPrestamos = applyLoans ? emp.deduccionPotencial : 0;
                        
                        let remainingDeduction = deduccionPrestamos;
                        const loanPayments = [];
                        
                        if (remainingDeduction > 0 && emp.loansList) {
                            emp.loansList.forEach(loan => {
                                if (remainingDeduction <= 0) return;
                                
                                const installments = loan.installments > 0 ? loan.installments : 1;
                                let suggestedInstallment = (loan.amount || 0) / installments;
                                if (suggestedInstallment > (loan.balance || 0)) {
                                    suggestedInstallment = (loan.balance || 0);
                                }
                                
                                let actualDeduction = Math.min(suggestedInstallment, remainingDeduction);
                                if (actualDeduction > (loan.balance || 0)) {
                                    actualDeduction = (loan.balance || 0);
                                }
                                
                                if (actualDeduction > 0) {
                                    loanPayments.push({
                                        loanId: loan.id,
                                        amount: actualDeduction,
                                        previousBalance: loan.balance || 0
                                    });
                                    remainingDeduction -= actualDeduction;
                                }
                            });
                        }

                        const paymentData = {
                            userId: emp.id,
                            paymentDate: new Date().toISOString().split('T')[0],
                            concepto: activeQuincena,
                            monto: Math.round(finalPagar),
                            diasPagados: dSalario,
                            diasAuxTransporte: dTransport,
                            desglose: {
                                salarioProrrateado,
                                auxilioTransporteProrrateado,
                                diasAuxTransporte: dTransport,
                                bonificacionM2: emp.bonificacion,
                                horasExtra: 0,
                                otros: 0,
                                abonoPrestamos: deduccionPrestamos,
                                detallesPrestamos: loanPayments,
                                deduccionSalud: -deduccionSalud,
                                deduccionPension: -deduccionPension,
                                baseDeduccion,
                                deduccionSobreMinimo: emp.deduccionSobreMinimo
                            },
                            horas: { totalHorasExtra: 0 },
                            createdAt: serverTimestamp(),
                            registeredBy: currentUserId,
                            registeredByName
                        };

                        const paymentHistoryRef = doc(collection(db, "users", emp.id, "paymentHistory"));
                        batch.set(paymentHistoryRef, paymentData);

                        if (emp.bonificacion > 0) {
                            const today = new Date();
                            const currentStatDocId = `${today.getFullYear()}_${String(today.getMonth() + 1).padStart(2, '0')}`;
                            const statRef = doc(db, "employeeStats", emp.id, "monthlyStats", currentStatDocId);
                            batch.set(statRef, { bonificacionPagada: true }, { merge: true });
                        }

                        loanPayments.forEach(pago => {
                            const loanRef = doc(db, "users", emp.id, "loans", pago.loanId);
                            const newBalance = pago.previousBalance - pago.amount;
                            const updateData = { balance: newBalance };
                            if (newBalance <= 0) {
                                updateData.status = 'paid';
                                updateData.paidAt = serverTimestamp();
                            }
                            batch.update(loanRef, updateData);
                        });

                        hasUpdates = true;

                        exportData.push({
                            "Tipo de Identificación": 1,
                            "Número de Identificación": emp.cedula,
                            "Nombre": cleanTextForBank(emp.firstName || '').toUpperCase(),
                            "Apellido": cleanTextForBank(emp.lastName || '').toUpperCase(),
                            "Código del Banco": getBankCode(emp.bankName),
                            "Tipo de Producto o Servicio": getProductType(emp.bankName),
                            "Número del Producto o Servicio": emp.accountNumber,
                            "Valor del pago o de la recarga": Math.round(finalPagar),
                            "Referencia (Opcional)": "",
                            "Correo Electrónico (Opcional)": emp.email || "dvidriosexito@gmail.com",
                            "Descripción o Detalle (Opcional)": cleanTextForBank(formatDescription(activeQuincena))
                        });
                    }
                });

                if (exportData.length === 0) {
                    alert("Por favor selecciona al menos un colaborador para exportar.");
                    return;
                }

                const confirmBtn = document.getElementById('btn-confirm-export-excel');
                confirmBtn.disabled = true;
                confirmBtn.innerHTML = '<div class="loader-small-white mx-auto"></div> Registrando...';

                try {
                    if (hasUpdates) {
                        await batch.commit();
                    }

                    await window.ensureXLSX();
                    const ws = XLSX.utils.json_to_sheet(exportData);
                    const wb = XLSX.utils.book_new();
                    XLSX.utils.book_append_sheet(wb, ws, "Dispersión");

                    const today = new Date();
                    let payDay = today.getDate();
                    const monthsListSpanish = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
                    let payMonthName = monthsListSpanish[today.getMonth()];
                    
                    const conceptLower = activeQuincena.toLowerCase();
                    if (conceptLower.includes('primera')) payDay = 15;
                    else if (conceptLower.includes('segunda')) payDay = 30;
                    
                    for (let i = 0; i < monthsListSpanish.length; i++) {
                        if (conceptLower.includes(monthsListSpanish[i])) {
                            payMonthName = monthsListSpanish[i];
                            break;
                        }
                    }

                    const filename = `nomina ${payDay} de ${payMonthName}.xlsx`;
                    XLSX.writeFile(wb, filename);
                    
                    closeModal();
                    if (window.showToast) window.showToast("Pagos registrados y dispersión exportada exitosamente.", "success");
                    
                    loadNominaQuincenalTab(container);
                } catch (e) {
                    console.error(e);
                    alert("Error procesando exportación: " + e.message);
                    confirmBtn.disabled = false;
                    confirmBtn.innerHTML = '<i class="fa-solid fa-file-excel text-base"></i> Confirmar y Descargar Excel';
                }
            };

            exportModal.classList.remove('opacity-0', 'pointer-events-none');
            setTimeout(() => {
                const card = document.getElementById('export-nomina-modal-card');
                if (card) card.classList.remove('scale-95');
            }, 50);
        });

        updateView();

    } catch (e) {
        console.error("Error cargando previsualización de nómina:", e);
        tableBody.innerHTML = `<tr><td colspan="7" class="text-center py-10 text-rose-500">Error al compilar nómina: ${e.message}</td></tr>`;
    }
}

// ==========================================
// 5. SUB-TAB 2: PRESTACIONES SOCIALES
// ==========================================

function loadPrestacionesTab(container) {
    container.innerHTML = `
        <div class="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 space-y-6">
            <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-4 border-b border-slate-100">
                <div>
                    <h3 class="text-lg font-bold text-slate-800"><i class="fa-solid fa-gift text-indigo-500 mr-1"></i> Liquidación de Prestaciones</h3>
                    <p class="text-xs text-slate-400 mt-1">Liquida Prima de Servicios, Cesantías o Vacaciones para un colaborador específico.</p>
                </div>
                <div class="flex items-center gap-3 w-full md:w-auto">
                    <label for="prestaciones-user-select" class="text-xs font-bold text-slate-500 uppercase shrink-0">Colaborador:</label>
                    <select id="prestaciones-user-select" class="w-full md:w-64 border border-slate-200 rounded-xl p-2.5 text-sm font-semibold bg-white shadow-xs focus:ring-2 focus:ring-indigo-500 outline-none">
                        <option value="">-- Seleccione un Colaborador --</option>
                    </select>
                </div>
            </div>

            <div id="prestaciones-details-area" class="min-h-[300px] flex items-center justify-center bg-slate-50/50 border border-slate-200 border-dashed rounded-2xl">
                <div class="text-center p-6 text-slate-450">
                    <span class="text-4xl">👤</span>
                    <h4 class="font-bold text-sm mt-2 text-slate-700">Sin Operario Seleccionado</h4>
                    <p class="text-xs max-w-xs mx-auto mt-1">Elija un colaborador de la lista superior para liquidar sus prestaciones sociales.</p>
                </div>
            </div>
        </div>
    `;

    const select = document.getElementById('prestaciones-user-select');
    const usersMap = getUsersMap();
    const activeUsers = [];
    usersMap.forEach((user, id) => {
        if (user.status === 'active') activeUsers.push({ id, ...user });
    });

    activeUsers.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));

    activeUsers.forEach(u => {
        const option = document.createElement('option');
        option.value = u.id;
        option.textContent = `${u.firstName} ${u.lastName} (C.C. ${u.idNumber || 'N/A'})`;
        select.appendChild(option);
    });

    select.addEventListener('change', (e) => {
        const userId = e.target.value;
        const detailsArea = document.getElementById('prestaciones-details-area');
        if (!userId) {
            detailsArea.className = "min-h-[300px] flex items-center justify-center bg-slate-50/50 border border-slate-200 border-dashed rounded-2xl";
            detailsArea.innerHTML = `
                <div class="text-center p-6 text-slate-450">
                    <span class="text-4xl">👤</span>
                    <h4 class="font-bold text-sm mt-2 text-slate-700">Sin Operario Seleccionado</h4>
                    <p class="text-xs max-w-xs mx-auto mt-1">Elija un colaborador de la lista superior para liquidar sus prestaciones sociales.</p>
                </div>
            `;
            return;
        }

        detailsArea.className = "space-y-6";
        loadIndividualDashboardIntoContainer(userId, detailsArea, 'prima');
    });
}

// ==========================================
// 6. SUB-TAB 3: LIQUIDACIÓN DE CONTRATO
// ==========================================

function loadLiquidacionesTab(container) {
    container.innerHTML = `
        <div class="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 space-y-6">
            <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-4 border-b border-slate-100">
                <div>
                    <h3 class="text-lg font-bold text-slate-800"><i class="fa-solid fa-gavel text-rose-500 mr-1"></i> Desvinculación y Liquidación Final</h3>
                    <p class="text-xs text-slate-400 mt-1">Cierre definitivo de contrato laboral, cálculo de indemnizaciones y archivo de operario.</p>
                </div>
                <div class="flex items-center gap-3 w-full md:w-auto">
                    <label for="liquidaciones-user-select" class="text-xs font-bold text-slate-500 uppercase shrink-0">Colaborador:</label>
                    <select id="liquidaciones-user-select" class="w-full md:w-64 border border-slate-200 rounded-xl p-2.5 text-sm font-semibold bg-white shadow-xs focus:ring-2 focus:ring-rose-500 outline-none">
                        <option value="">-- Seleccione un Colaborador --</option>
                    </select>
                </div>
            </div>

            <div id="liquidaciones-details-area" class="min-h-[300px] flex items-center justify-center bg-slate-50/50 border border-slate-200 border-dashed rounded-2xl">
                <div class="text-center p-6 text-slate-450">
                    <span class="text-4xl">⚖️</span>
                    <h4 class="font-bold text-sm mt-2 text-slate-700">Sin Operario Seleccionado</h4>
                    <p class="text-xs max-w-xs mx-auto mt-1">Elija un colaborador de la lista superior para calcular su liquidación de retiro.</p>
                </div>
            </div>
        </div>
    `;

    const select = document.getElementById('liquidaciones-user-select');
    const usersMap = getUsersMap();
    const activeUsers = [];
    usersMap.forEach((user, id) => {
        if (user.status === 'active') activeUsers.push({ id, ...user });
    });

    activeUsers.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));

    activeUsers.forEach(u => {
        const option = document.createElement('option');
        option.value = u.id;
        option.textContent = `${u.firstName} ${u.lastName} (C.C. ${u.idNumber || 'N/A'})`;
        select.appendChild(option);
    });

    select.addEventListener('change', (e) => {
        const userId = e.target.value;
        const detailsArea = document.getElementById('liquidaciones-details-area');
        if (!userId) {
            detailsArea.className = "min-h-[300px] flex items-center justify-center bg-slate-50/50 border border-slate-200 border-dashed rounded-2xl";
            detailsArea.innerHTML = `
                <div class="text-center p-6 text-slate-450">
                    <span class="text-4xl">⚖️</span>
                    <h4 class="font-bold text-sm mt-2 text-slate-700">Sin Operario Seleccionado</h4>
                    <p class="text-xs max-w-xs mx-auto mt-1">Elija un colaborador de la lista superior para calcular su liquidación de retiro.</p>
                </div>
            `;
            return;
        }

        detailsArea.className = "space-y-6";
        loadIndividualDashboardIntoContainer(userId, detailsArea, 'liquidacion');
    });
}

// ==========================================
// 7. SUB-TAB 4: GESTIÓN DE PRÉSTAMOS
// ==========================================

function loadGestionPrestamosTab(container) {
    container.innerHTML = `
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div class="lg:col-span-1 space-y-6">
                <div class="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 space-y-4">
                    <div class="flex justify-between items-center border-b border-slate-100 pb-3">
                        <h3 class="text-base font-bold text-slate-800 flex items-center gap-2">
                            <span class="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse"></span>
                            Solicitudes Pendientes
                        </h3>
                    </div>
                    <div id="prestamos-requests-container" class="space-y-3 max-h-[500px] overflow-y-auto pr-1">
                        <div class="text-center py-8 text-slate-450"><div class="loader-small mx-auto mb-2"></div>Cargando solicitudes...</div>
                    </div>
                </div>

                <div class="bg-gradient-to-tr from-indigo-900 to-slate-800 text-white p-5 rounded-2xl shadow-md space-y-4">
                    <h4 class="font-black text-sm uppercase tracking-wider text-indigo-200">Acción de Caja</h4>
                    <p class="text-xs text-indigo-100 leading-relaxed">¿Desea conceder un adelanto de nómina o préstamo directo de forma manual?</p>
                    <button id="btn-create-direct-loan" class="w-full bg-[#e67817] hover:bg-amber-600 text-white text-xs font-bold py-2.5 px-4 rounded-xl transition-all shadow-xs flex items-center justify-center gap-2 transform active:scale-95">
                        <i class="fa-solid fa-plus"></i> Registrar Préstamo Directo
                    </button>
                </div>
            </div>

            <div class="lg:col-span-2 space-y-6">
                <div class="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 space-y-4">
                    <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-slate-100 pb-3">
                        <div>
                            <h3 class="text-base font-bold text-slate-800">Cartera Activa de Operarios</h3>
                            <p class="text-[10px] font-bold text-slate-450 uppercase mt-0.5">Saldos pendientes y amortizaciones</p>
                        </div>
                        <input type="text" id="loans-table-search" placeholder="Buscar operario..." 
                            class="p-2 border border-slate-200 rounded-xl text-xs bg-slate-50/50 hover:bg-white focus:bg-white outline-none focus:ring-2 focus:ring-[#e67817] w-full sm:w-48 transition-all">
                    </div>

                    <div class="overflow-hidden rounded-t-xl border border-slate-200 shadow-xs">
                        <div class="overflow-x-auto">
                            <table class="w-full text-xs text-left" id="active-loans-table">
                                <thead class="text-[10px] text-slate-400 uppercase bg-slate-50 border-b border-slate-250">
                                    <tr>
                                        <th class="px-4 py-3 font-black tracking-wider">Colaborador</th>
                                        <th class="px-4 py-3 font-black tracking-wider text-right">Monto Inicial</th>
                                        <th class="px-4 py-3 font-black tracking-wider text-right text-rose-600">Saldo Deuda</th>
                                        <th class="px-4 py-3 font-black tracking-wider text-center w-24">Cuotas Restantes</th>
                                        <th class="px-4 py-3 font-black tracking-wider text-center">Acción</th>
                                    </tr>
                                </thead>
                                <tbody id="active-loans-tbody" class="divide-y divide-slate-100">
                                    <tr><td colspan="5" class="text-center py-8 text-slate-450">Cargando base de deudores...</td></tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                    
                    <div id="active-loans-pagination" class="flex justify-between items-center bg-slate-50 border border-slate-200 border-t-0 p-3 rounded-b-xl text-[11px] font-semibold text-slate-500">
                        <button id="active-loans-prev-btn" class="bg-white border border-slate-200 rounded-lg py-1 px-2.5 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors" disabled>&larr; Ant</button>
                        <span id="active-loans-page-info">Pág 1 de 1</span>
                        <button id="active-loans-next-btn" class="bg-white border border-slate-200 rounded-lg py-1 px-2.5 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors" disabled>Sig &rarr;</button>
                    </div>
                </div>
            </div>
        </div>
    `;

    const renderRequests = () => {
        const reqContainer = document.getElementById('prestamos-requests-container');
        if (!reqContainer) return;

        if (allPendingLoans.length === 0) {
            reqContainer.innerHTML = `
                <div class="text-center py-8 bg-slate-50 rounded-xl border border-slate-150 border-dashed">
                    <span class="text-2xl">🎉</span>
                    <p class="text-xs font-bold text-slate-600 mt-1">Sin Solicitudes Pendientes</p>
                    <p class="text-[10px] text-slate-455 mt-0.5">Todos los adelantos están al día.</p>
                </div>
            `;
            return;
        }

        const sortedRequests = [...allPendingLoans].sort((a, b) => new Date(b.requestDate) - new Date(a.requestDate));
        reqContainer.innerHTML = sortedRequests.map(p => {
            return `
                <div class="bg-slate-50 border border-slate-200/80 p-3.5 rounded-xl text-left space-y-2.5 relative hover:shadow-xs transition-shadow">
                    <div>
                        <div class="flex justify-between items-start">
                            <h4 class="text-xs font-black text-slate-800 leading-tight">${p.employeeName}</h4>
                            <span class="text-[9px] font-black text-indigo-650 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded uppercase font-mono">${formatCurrency(p.amount)}</span>
                        </div>
                        <p class="text-[11px] text-slate-500 italic mt-1 leading-normal">"${p.reason || 'Sin motivo especificado'}"</p>
                        <div class="flex justify-between items-center text-[9px] text-slate-400 font-semibold mt-1">
                            <span>Solicitado: ${p.requestDate}</span>
                            ${p.installments ? `<span class="bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded border border-slate-200">Cuotas: ${p.installments}</span>` : ''}
                        </div>
                    </div>
                    <div class="flex gap-2 justify-end border-t border-slate-200/60 pt-2 shrink-0">
                        <button data-loan-json='${JSON.stringify(p)}' class="approve-loan-tab-btn bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-black uppercase tracking-wider px-3.5 py-1.5 rounded-lg transition-colors shadow-sm transform active:scale-95">Aprobar</button>
                        <button data-loan-id="${p.id}" data-action="denegado" class="loan-action-tab-btn bg-rose-600 hover:bg-rose-700 text-white text-[10px] font-black uppercase tracking-wider px-3 py-1.5 rounded-lg transition-colors shadow-sm transform active:scale-95">Denegar</button>
                    </div>
                </div>
            `;
        }).join('');

        reqContainer.querySelectorAll('.approve-loan-tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const loan = JSON.parse(e.currentTarget.dataset.loanJson);
                showApproveLoanModal(loan);
            });
        });

        reqContainer.querySelectorAll('.loan-action-tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                handleLoanAction(e.currentTarget.dataset.loanId, e.currentTarget.dataset.action);
            });
        });
    };

    renderRequests();
    
    const loansQuery = query(collection(db, "prestamos"), where("status", "==", "solicitado"));
    unsubscribeLoansTab = onSnapshot(loansQuery, (snapshot) => {
        const pending = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setAllPendingLoans(pending);
        updateLoanBadge();
        renderRequests();
    });

    const activeLoansBody = document.getElementById('active-loans-tbody');
    const activeLoansQuery = query(collectionGroup(db, 'loans'), where('status', '==', 'active'));
    
    const updateActiveLoansTable = async () => {
        try {
            const snap = await getDocs(activeLoansQuery);
            if (!document.getElementById('active-loans-tbody')) return;

            if (snap.empty) {
                activeLoansBody.innerHTML = `<tr><td colspan="5" class="text-center py-8 text-slate-450 italic">No hay deudas activas en la empresa.</td></tr>`;
                return;
            }

            const usersMap = getUsersMap();
            const list = [];
            snap.forEach(docSnap => {
                const loan = docSnap.data();
                const userId = docSnap.ref.parent.parent.id;
                const user = usersMap.get(userId);
                list.push({
                    id: docSnap.id,
                    userId: userId,
                    employeeName: user ? `${user.firstName} ${user.lastName}` : 'Operario Desconocido',
                    ...loan
                });
            });

            list.sort((a, b) => a.employeeName.localeCompare(b.employeeName));

            let activeLoansCurrentPage = 1;
            const PAGE_SIZE = 6;

            const renderTable = (filterTerm = '') => {
                const filtered = list.filter(l => 
                    l.employeeName.toLowerCase().includes(filterTerm) ||
                    (l.description || '').toLowerCase().includes(filterTerm)
                );

                const totalPages = Math.ceil(filtered.length / PAGE_SIZE) || 1;
                if (activeLoansCurrentPage > totalPages) {
                    activeLoansCurrentPage = totalPages;
                }

                const startIndex = (activeLoansCurrentPage - 1) * PAGE_SIZE;
                const endIndex = startIndex + PAGE_SIZE;
                const pageData = filtered.slice(startIndex, endIndex);

                activeLoansBody.innerHTML = '';
                if (pageData.length === 0) {
                    activeLoansBody.innerHTML = `<tr><td colspan="5" class="text-center py-8 text-slate-450">Sin resultados.</td></tr>`;
                    updatePaginationUI(0, 1);
                    return;
                }

                pageData.forEach(loan => {
                    const tr = document.createElement('tr');
                    tr.className = "hover:bg-slate-50/50 transition-colors border-b border-slate-100 last:border-0";
                    tr.innerHTML = `
                        <td class="px-4 py-3 font-bold text-slate-800">
                            <div>
                                <p class="text-xs font-black text-slate-700">${loan.employeeName}</p>
                                <p class="text-[9px] text-slate-400 mt-0.5 leading-none uppercase">${loan.description || 'Préstamo'}</p>
                            </div>
                        </td>
                        <td class="px-4 py-3 text-right font-medium text-slate-500 font-mono">${currencyFormatter.format(loan.amount)}</td>
                        <td class="px-4 py-3 text-right font-bold text-rose-600 font-mono">${currencyFormatter.format(loan.balance)}</td>
                        <td class="px-4 py-3 text-center font-bold text-slate-600 font-mono">${loan.installments || 1}</td>
                        <td class="px-4 py-3 text-center">
                            <button class="btn-abono-manual bg-indigo-550/10 border border-indigo-150 text-indigo-650 hover:bg-indigo-650 hover:text-white px-2.5 py-1 rounded-lg font-bold text-[10px] transition-all transform active:scale-95 shadow-xs" 
                                data-loan-json='${JSON.stringify(loan)}'>
                                <i class="fa-solid fa-piggy-bank"></i> Abono
                            </button>
                        </td>
                    `;

                    tr.querySelector('.btn-abono-manual').onclick = (e) => {
                        const lData = JSON.parse(e.currentTarget.dataset.loanJson);
                        showAbonoManualModal(lData, updateActiveLoansTable);
                    };

                    activeLoansBody.appendChild(tr);
                });

                updatePaginationUI(filtered.length, totalPages);
            };

            const updatePaginationUI = (totalItems, totalPages) => {
                const prevBtn = document.getElementById('active-loans-prev-btn');
                const nextBtn = document.getElementById('active-loans-next-btn');
                const pageInfo = document.getElementById('active-loans-page-info');

                if (pageInfo) {
                    pageInfo.textContent = `Pág ${activeLoansCurrentPage} de ${totalPages}`;
                }

                if (prevBtn) {
                    prevBtn.disabled = (activeLoansCurrentPage === 1);
                    prevBtn.onclick = () => {
                        if (activeLoansCurrentPage > 1) {
                            activeLoansCurrentPage--;
                            renderTable(document.getElementById('loans-table-search')?.value.toLowerCase() || '');
                        }
                    };
                }

                if (nextBtn) {
                    nextBtn.disabled = (activeLoansCurrentPage === totalPages);
                    nextBtn.onclick = () => {
                        if (activeLoansCurrentPage < totalPages) {
                            activeLoansCurrentPage++;
                            renderTable(document.getElementById('loans-table-search')?.value.toLowerCase() || '');
                        }
                    };
                }
            };

            renderTable();

            const searchInput = document.getElementById('loans-table-search');
            if (searchInput) {
                searchInput.addEventListener('input', (e) => {
                    activeLoansCurrentPage = 1;
                    renderTable(e.target.value.toLowerCase());
                });
            }

        } catch (e) {
            console.error("Error al compilar cartera de operarios:", e);
            activeLoansBody.innerHTML = `<tr><td colspan="5" class="text-center py-8 text-rose-500">Error al consultar base de datos: ${e.message}</td></tr>`;
        }
    };

    updateActiveLoansTable();

    document.getElementById('btn-create-direct-loan').onclick = () => {
        showDirectLoanModal(updateActiveLoansTable);
    };
}

function showAbonoManualModal(loan, onCompletedCallback) {
    const modalContentWrapper = document.getElementById('modal-content-wrapper');
    const metodosDePagoHTML = METODOS_DE_PAGO.map(metodo => `<option value="${metodo}">${metodo}</option>`).join('');

    modalContentWrapper.innerHTML = `
        <div class="modal-card max-w-md w-full mx-auto text-left border border-slate-200">
            <div class="modal-header-fixed bg-indigo-50/50">
                <h2 class="text-base font-extrabold text-slate-800">Registrar Abono Manual</h2>
                <button id="close-abono-modal" class="text-slate-400 hover:text-slate-700 text-xl font-bold">&times;</button>
            </div>
            <form id="abono-manual-form" class="modal-body-scroll space-y-4">
                <div class="bg-indigo-50 border border-indigo-100 p-4 rounded-xl space-y-1.5 text-xs">
                    <p class="text-slate-700"><span class="font-bold text-slate-800">Colaborador:</span> ${loan.employeeName}</p>
                    <p class="text-slate-700"><span class="font-bold text-slate-800">Préstamo:</span> ${loan.description || 'Detalle'}</p>
                    <p class="text-slate-700 flex justify-between items-baseline"><span class="font-bold text-slate-800">Saldo Pendiente:</span> <span class="text-sm font-black text-rose-600 font-mono">${currencyFormatter.format(loan.balance)}</span></p>
                </div>
                <div>
                    <label for="abono-amount" class="block text-xs font-bold text-slate-500 uppercase mb-1">Monto del Abono</label>
                    <input type="text" id="abono-amount" class="w-full p-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-right font-mono font-bold text-sm bg-white" required>
                </div>
                <div>
                    <label for="abono-payment-method" class="block text-xs font-bold text-slate-500 uppercase mb-1">Método de Pago</label>
                    <select id="abono-payment-method" class="w-full p-2.5 border border-slate-200 rounded-xl bg-white focus:ring-2 focus:ring-indigo-500 outline-none text-xs font-bold text-slate-700" required>
                        ${metodosDePagoHTML}
                    </select>
                </div>
                <div class="flex gap-3 justify-end pt-4 border-t border-slate-100 shrink-0">
                    <button type="button" id="cancel-abono-btn" class="bg-slate-200 hover:bg-slate-300 text-slate-700 px-4 py-2.5 rounded-xl font-bold transition-colors text-xs uppercase tracking-wider">Cancelar</button>
                    <button type="submit" id="btn-submit-abono" class="bg-indigo-650 hover:bg-indigo-755 text-white px-5 py-2.5 rounded-xl font-bold transition-colors shadow-xs text-xs uppercase tracking-wider">Registrar Abono</button>
                </div>
            </form>
        </div>
    `;

    document.getElementById('modal').classList.remove('hidden');
    document.getElementById('close-abono-modal').onclick = hideModal;
    document.getElementById('cancel-abono-btn').onclick = hideModal;

    const abonoInput = document.getElementById('abono-amount');
    setupCurrencyInput(abonoInput);

    document.getElementById('abono-manual-form').onsubmit = async (e) => {
        e.preventDefault();
        const amount = unformatCurrency(abonoInput.value);
        const paymentMethod = document.getElementById('abono-payment-method').value;

        if (amount <= 0) {
            alert("El monto debe ser mayor a cero.");
            return;
        }
        if (amount > loan.balance) {
            alert(`El abono supera el saldo total de la deuda (${currencyFormatter.format(loan.balance)}).`);
            return;
        }

        const confirmBtn = document.getElementById('btn-submit-abono');
        confirmBtn.disabled = true;
        confirmBtn.innerHTML = '<div class="loader-small-white mx-auto"></div> Guardando...';

        try {
            const approvalDate = new Date();
            const dateString = approvalDate.toISOString().split('T')[0];

            const batch = writeBatch(db);
            const paymentHistoryRef = doc(collection(db, "users", loan.userId, "paymentHistory"));
            batch.set(paymentHistoryRef, {
                userId: loan.userId,
                paymentDate: dateString,
                concepto: `Abono a Préstamo (Manual)`,
                monto: 0,
                details: {
                    montoAbono: amount,
                    metodoAbono: paymentMethod,
                    loanId: loan.id,
                    saldoAnterior: loan.balance,
                    saldoNuevo: loan.balance - amount,
                    nota: `Abono manual registrado por Administración`
                },
                createdAt: serverTimestamp(),
                registeredBy: currentUser.uid,
                isSpecial: true
            });

            const loanRef = doc(db, "users", loan.userId, "loans", loan.id);
            const newBalance = loan.balance - amount;
            const updateData = { balance: newBalance };
            if (newBalance <= 0) {
                updateData.status = 'paid';
                updateData.paidAt = serverTimestamp();
            }
            batch.update(loanRef, updateData);

            await batch.commit();

            hideModal();
            if (window.showToast) window.showToast("Abono registrado correctamente.", "success");
            if (onCompletedCallback) onCompletedCallback();

        } catch (err) {
            console.error("Error al registrar abono:", err);
            alert("Error: " + err.message);
            confirmBtn.disabled = false;
            confirmBtn.innerHTML = "Registrar Abono";
        }
    };
}

function showDirectLoanModal(onCompletedCallback) {
    const modalContentWrapper = document.getElementById('modal-content-wrapper');
    const metodosDePagoHTML = METODOS_DE_PAGO.map(metodo => `<option value="${metodo}">${metodo}</option>`).join('');

    const usersMap = getUsersMap();
    const activeUsers = [];
    usersMap.forEach((user, id) => {
        if (user.status === 'active') activeUsers.push({ id, ...user });
    });
    activeUsers.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));

    const userOptionsHTML = activeUsers.map(u => `<option value="${u.id}">${u.firstName} ${u.lastName} (C.C. ${u.idNumber || 'N/A'})</option>`).join('');

    modalContentWrapper.innerHTML = `
        <div class="modal-card max-w-md w-full mx-auto text-left border border-slate-200">
            <div class="modal-header-fixed bg-indigo-50/50">
                <h2 class="text-base font-extrabold text-slate-800">Registrar Préstamo Directo</h2>
                <button id="close-direct-loan-modal" class="text-slate-400 hover:text-slate-700 text-xl font-bold">&times;</button>
            </div>
            <form id="direct-loan-form" class="modal-body-scroll space-y-4">
                <div>
                    <label for="direct-loan-user-select" class="block text-xs font-bold text-slate-500 uppercase mb-1">Seleccionar Colaborador</label>
                    <select id="direct-loan-user-select" class="w-full p-2.5 border border-slate-200 rounded-xl bg-white focus:ring-2 focus:ring-indigo-500 outline-none text-xs font-semibold" required>
                        <option value="">-- Elija un Colaborador --</option>
                        ${userOptionsHTML}
                    </select>
                </div>
                <div>
                    <label for="direct-loan-amount" class="block text-xs font-bold text-slate-500 uppercase mb-1">Monto del Préstamo</label>
                    <input type="text" id="direct-loan-amount" class="w-full p-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-right font-mono font-bold text-sm bg-white" required>
                </div>
                <div class="grid grid-cols-2 gap-4">
                    <div>
                        <label for="direct-loan-installments" class="block text-xs font-bold text-slate-500 uppercase mb-1">Número de Cuotas</label>
                        <input type="number" id="direct-loan-installments" min="1" max="100" value="1" class="w-full p-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-center font-bold text-sm bg-white" required>
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-slate-450 uppercase mb-1">Cuota Estimada</label>
                        <div id="direct-loan-quota-display" class="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-black text-center text-sm text-indigo-700 font-mono">$ 0</div>
                    </div>
                </div>
                <div>
                    <label for="direct-loan-description" class="block text-xs font-bold text-slate-500 uppercase mb-1">Motivo / Descripción</label>
                    <textarea id="direct-loan-description" rows="2" class="w-full p-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-xs leading-normal bg-white" placeholder="Ej: Adelanto de nómina, gastos médicos, etc." required></textarea>
                </div>
                <div>
                    <label for="direct-loan-payment-method" class="block text-xs font-bold text-slate-500 uppercase mb-1">Caja / Fuente del Desembolso</label>
                    <select id="direct-loan-payment-method" class="w-full p-2.5 border border-slate-200 rounded-xl bg-white focus:ring-2 focus:ring-indigo-500 outline-none text-xs font-bold text-slate-700" required>
                        ${metodosDePagoHTML}
                    </select>
                </div>
                <div class="flex gap-3 justify-end pt-4 border-t border-slate-100 shrink-0">
                    <button type="button" id="cancel-direct-loan-btn" class="bg-slate-200 hover:bg-slate-300 text-slate-700 px-4 py-2.5 rounded-xl font-bold transition-colors text-xs uppercase tracking-wider">Cancelar</button>
                    <button type="submit" id="btn-submit-direct-loan" class="bg-indigo-650 hover:bg-indigo-755 text-white px-5 py-2.5 rounded-xl font-bold transition-colors shadow-xs text-xs uppercase tracking-wider">Registrar Préstamo</button>
                </div>
            </form>
        </div>
    `;

    document.getElementById('modal').classList.remove('hidden');
    document.getElementById('close-direct-loan-modal').onclick = hideModal;
    document.getElementById('cancel-direct-loan-btn').onclick = hideModal;

    const amountInput = document.getElementById('direct-loan-amount');
    const installmentsInput = document.getElementById('direct-loan-installments');
    const quotaDisplay = document.getElementById('direct-loan-quota-display');

    setupCurrencyInput(amountInput);

    const recalculateQuota = () => {
        const amount = unformatCurrency(amountInput.value);
        const installments = parseInt(installmentsInput.value) || 1;
        if (amount > 0 && installments > 0) {
            quotaDisplay.textContent = currencyFormatter.format(amount / installments);
        } else {
            quotaDisplay.textContent = "$ 0";
        }
    };

    amountInput.addEventListener('input', recalculateQuota);
    installmentsInput.addEventListener('input', recalculateQuota);

    document.getElementById('direct-loan-form').onsubmit = async (e) => {
        e.preventDefault();
        const userId = document.getElementById('direct-loan-user-select').value;
        const amount = unformatCurrency(amountInput.value);
        const installments = parseInt(installmentsInput.value) || 1;
        const description = document.getElementById('direct-loan-description').value;
        const paymentMethod = document.getElementById('direct-loan-payment-method').value;

        if (!userId) { alert("Debe seleccionar un colaborador."); return; }
        if (amount <= 0) { alert("El monto debe ser mayor a cero."); return; }
        
        const confirmBtn = document.getElementById('btn-submit-direct-loan');
        confirmBtn.disabled = true;
        confirmBtn.innerHTML = '<div class="loader-small-white mx-auto"></div> Guardando...';

        try {
            const today = new Date();
            const dateString = today.toISOString().split('T')[0];
            const opUser = activeUsers.find(u => u.id === userId);
            const employeeName = opUser ? `${opUser.firstName} ${opUser.lastName}` : 'Operario';

            const batch = writeBatch(db);
            const loanRef = doc(collection(db, "users", userId, "loans"));
            batch.set(loanRef, {
                amount: amount,
                balance: amount,
                description: description,
                installments: installments,
                date: dateString,
                status: 'active',
                createdAt: serverTimestamp(),
                createdBy: currentUser.uid
            });

            const gastoRef = doc(collection(db, "gastos"));
            batch.set(gastoRef, {
                fecha: dateString,
                proveedorId: userId,
                proveedorNombre: `Préstamo Concedido: ${employeeName}`,
                numeroFactura: `Préstamo Directo RRHH`,
                valorTotal: amount,
                fuentePago: paymentMethod,
                registradoPor: currentUser.uid,
                timestamp: Date.now(),
                isLoanAdvance: true,
                _lastUpdated: serverTimestamp()
            });

            const nuevoPago = {
                motivo: `Préstamo: ${description.substring(0, 30)}`,
                valor: amount,
                fecha: dateString,
                fuentePago: paymentMethod,
                timestamp: today.toISOString()
            };
            const userRef = doc(db, "users", userId);
            batch.update(userRef, {
                pagos: arrayUnion(nuevoPago),
                _lastUpdated: serverTimestamp()
            });

            await batch.commit();

            hideModal();
            if (window.showToast) window.showToast("Préstamo directo registrado exitosamente.", "success");
            if (onCompletedCallback) onCompletedCallback();

        } catch (err) {
            console.error("Error al registrar préstamo directo:", err);
            alert("Error: " + err.message);
            confirmBtn.disabled = false;
            confirmBtn.innerHTML = "Registrar Préstamo";
        }
    };
}

function showApproveLoanModal(loan, fromListModal = false) {
    const modalContentWrapper = document.getElementById('modal-content-wrapper');
    const metodosDePagoHTML = METODOS_DE_PAGO.map(metodo => `<option value="${metodo}">${metodo}</option>`).join('');
    const applicant = allUsers.find(u => u.id === loan.employeeId);

    const getInitials = (name) => {
        if (!name) return '??';
        const parts = name.trim().split(/\s+/);
        if (parts.length >= 2) {
            return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
        }
        return parts[0].substring(0, 2).toUpperCase();
    };

    modalContentWrapper.innerHTML = `
        <div class="modal-card max-w-3xl w-full mx-auto text-left border border-slate-200 overflow-hidden rounded-2xl shadow-xl bg-white">
            <!-- Header -->
            <div class="bg-gradient-to-r from-emerald-600 to-teal-650 p-4 text-white flex items-center justify-between">
                <div class="flex items-center gap-3">
                    <div class="bg-white/20 p-2.5 rounded-full flex items-center justify-center">
                        <i class="fa-solid fa-file-signature text-xl text-white"></i>
                    </div>
                    <div>
                        <h2 class="text-base font-black text-white leading-tight">Aprobación de Crédito</h2>
                        <p class="text-[10px] font-bold text-emerald-100 uppercase tracking-wider mt-0.5">Revisión final y autorización</p>
                    </div>
                </div>
                <button id="close-approve-loan-modal" class="text-white/80 hover:text-white text-2xl transition-colors">&times;</button>
            </div>

            <!-- Body -->
            <form id="approve-loan-form" class="modal-body-scroll p-6 space-y-6 bg-slate-50/50">
                <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <!-- Left Column -->
                    <div class="space-y-4">
                        <!-- Applicant Card -->
                        <div class="bg-white border border-slate-200 p-4 rounded-2xl flex items-center gap-3.5 shadow-xs">
                            <div class="w-12 h-12 rounded-full bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-650 font-black text-sm shrink-0">
                                ${getInitials(loan.employeeName)}
                            </div>
                            <div>
                                <span class="block text-[9px] font-black text-slate-400 uppercase tracking-widest">Solicitante</span>
                                <h4 class="text-sm font-black text-slate-800 leading-tight uppercase mt-0.5">${loan.employeeName}</h4>
                            </div>
                        </div>

                        <!-- Original Request Card -->
                        <div class="bg-white border border-slate-200 p-4 rounded-2xl shadow-xs space-y-3 text-left">
                            <div class="border-b border-slate-100 pb-2.5 flex justify-between items-center">
                                <span class="text-[9px] font-black text-slate-400 uppercase tracking-widest">Solicitud Original</span>
                                <span class="bg-slate-100 text-slate-600 text-[10px] font-black px-2 py-0.5 rounded border border-slate-200">${loan.installments || 1} Cuotas</span>
                            </div>
                            <div class="space-y-2">
                                <p class="text-2xl font-black text-slate-800 tracking-tight">${formatCurrency(loan.amount)}</p>
                                <div class="bg-slate-50 border border-slate-100/70 p-3 rounded-xl text-xs text-slate-500 italic leading-relaxed">
                                    "${loan.reason || 'Sin motivo especificado'}"
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Right Column -->
                    <div class="space-y-4">
                        <!-- Approval Conditions Card -->
                        <div class="bg-emerald-50/20 border border-emerald-100 p-4 rounded-2xl shadow-xs space-y-4 text-left">
                            <div class="flex items-center gap-2 border-b border-emerald-100/50 pb-2.5">
                                <i class="fa-solid fa-gavel text-emerald-600"></i>
                                <span class="text-[9px] font-black text-emerald-700 uppercase tracking-widest">Condiciones de Aprobación</span>
                            </div>
                            <div class="space-y-3">
                                <div>
                                    <label for="approve-loan-final-amount" class="block text-[9px] font-black text-emerald-700 uppercase tracking-wider mb-1.5">Monto Aprobado</label>
                                    <input type="text" id="approve-loan-final-amount" class="w-full border border-emerald-250 rounded-xl p-2.5 text-sm font-mono font-bold text-slate-800 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none bg-white transition-all text-right" value="${formatCurrency(loan.amount)}">
                                </div>
                                <div>
                                    <label for="approve-loan-final-installments" class="block text-[9px] font-black text-emerald-700 uppercase tracking-wider mb-1.5">Cuotas Finales</label>
                                    <input type="number" id="approve-loan-final-installments" class="w-full border border-emerald-250 rounded-xl p-2.5 text-sm font-bold text-slate-800 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none bg-white transition-all text-center" value="${loan.installments || 1}" min="1" max="100">
                                </div>
                            </div>
                        </div>

                        <!-- Internal Note -->
                        <div class="space-y-1.5 text-left">
                            <label for="approve-loan-internal-note" class="block text-[9px] font-black text-slate-400 uppercase tracking-widest">Nota Interna (Opcional)</label>
                            <textarea id="approve-loan-internal-note" class="w-full border border-slate-300 rounded-xl p-3 text-xs text-slate-700 placeholder-slate-400 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none bg-white transition-all" rows="2" placeholder="Ej: Aprobado según capacidad de pago..."></textarea>
                        </div>
                    </div>
                </div>

                <!-- Girar A Block -->
                <div class="bg-indigo-50/40 border border-indigo-100 p-3.5 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-left">
                    <div class="flex items-center gap-3">
                        <div class="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center shrink-0">
                            <i class="fa-solid fa-building-columns text-indigo-650 text-lg"></i>
                        </div>
                        <div>
                            <span class="block text-[8px] font-black text-indigo-400 uppercase tracking-widest">Girar a (Datos Destinatario)</span>
                            <h5 class="text-xs font-bold text-indigo-950 mt-0.5">
                                ${applicant?.bankName || 'No Registrado'} - ${applicant?.accountType || 'Sin Cuenta'}
                            </h5>
                        </div>
                    </div>
                    <div class="flex items-center gap-3">
                        <div class="bg-white border border-indigo-100 rounded-lg px-2.5 py-1.5 flex items-center gap-2 font-mono text-xs font-bold text-indigo-950">
                            <span id="transfer-account-number">${applicant?.accountNumber || 'No registrado'}</span>
                            ${applicant?.accountNumber ? `
                            <button type="button" id="btn-copy-account" class="text-indigo-400 hover:text-indigo-650 transition-colors" title="Copiar número de cuenta">
                                <i class="fa-regular fa-copy"></i>
                            </button>
                            ` : ''}
                        </div>
                    </div>
                </div>

                <!-- Fuente de Pago dropdown inside body -->
                <div class="space-y-1.5 text-left">
                    <label for="approve-loan-payment-method" class="block text-[9px] font-black text-slate-400 uppercase tracking-widest">Fuente de Pago (Caja/Banco origen)</label>
                    <select id="approve-loan-payment-method" class="w-full p-3 border border-slate-300 rounded-xl bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-xs font-bold text-slate-700" required>
                        ${metodosDePagoHTML}
                    </select>
                </div>

                <!-- Footer style buttons -->
                <div class="flex justify-between items-center pt-4 border-t border-slate-200/60 bg-white -mx-6 -mb-6 p-6 rounded-b-2xl shrink-0">
                    <button type="button" id="btn-reject-loan" class="text-rose-600 hover:text-rose-700 font-black text-xs uppercase tracking-wider flex items-center gap-1.5 transition-colors transform active:scale-95">
                        <i class="fa-solid fa-ban text-sm"></i> Rechazar
                    </button>
                    <div class="flex items-center gap-4">
                        <button type="button" id="btn-cancel-approve" class="text-slate-500 hover:text-slate-700 font-black text-xs uppercase tracking-wider transition-colors">
                            Cancelar
                        </button>
                        <button type="submit" id="btn-confirm-approve" class="bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs uppercase tracking-wider px-6 py-3 rounded-xl transition-all shadow-md flex items-center gap-1.5 transform active:scale-95">
                            <i class="fa-solid fa-check text-sm"></i> Aprobar
                        </button>
                    </div>
                </div>
            </form>
        </div>
    `;

    document.getElementById('modal').classList.remove('hidden');

    // Format final amount input
    const finalAmountInput = document.getElementById('approve-loan-final-amount');
    finalAmountInput.addEventListener('input', (e) => {
        formatCurrencyInput(e.target);
    });

    // Copy Account Button
    const btnCopy = document.getElementById('btn-copy-account');
    if (btnCopy) {
        btnCopy.onclick = () => {
            const num = document.getElementById('transfer-account-number').textContent;
            navigator.clipboard.writeText(num);
            if (window.showToast) window.showToast("Número de cuenta copiado.", 'success');
        };
    }

    // Cancel / Close Buttons
    document.getElementById('close-approve-loan-modal').onclick = () => {
        if (fromListModal && typeof showAllLoansModal === 'function') {
            showAllLoansModal(allPendingLoans);
        } else {
            hideModal();
        }
    };
    document.getElementById('btn-cancel-approve').onclick = () => {
        if (fromListModal && typeof showAllLoansModal === 'function') {
            showAllLoansModal(allPendingLoans);
        } else {
            hideModal();
        }
    };

    // Reject Button
    document.getElementById('btn-reject-loan').onclick = () => {
        _openConfirmModal("¿Está seguro de que desea rechazar y eliminar esta solicitud de préstamo?", () => {
            handleLoanAction(loan.id, 'denegado');
        });
    };

    // Submit Form (Approve)
    document.getElementById('approve-loan-form').onsubmit = (e) => {
        e.preventDefault();
        const paymentMethod = document.getElementById('approve-loan-payment-method').value;
        const finalInstallments = parseInt(document.getElementById('approve-loan-final-installments').value) || 1;
        const approvedAmount = unformatCurrency(finalAmountInput.value);
        const internalNote = document.getElementById('approve-loan-internal-note').value;

        handleApproveLoan(loan, paymentMethod, finalInstallments, approvedAmount, internalNote);
    };
}

async function handleApproveLoan(loan, paymentMethod, installments, approvedAmount, internalNote) {
    showModalMessage("Procesando aprobación...", true);
    try {
        const approvalDate = new Date();
        const dateString = approvalDate.toISOString().split('T')[0];

        const finalAmount = approvedAmount !== undefined ? approvedAmount : loan.amount;

        const nuevoGasto = {
            fecha: dateString,
            proveedorId: loan.employeeId,
            proveedorNombre: `Préstamo Aprobado: ${loan.employeeName}`,
            numeroFactura: `Préstamo RRHH`,
            valorTotal: finalAmount,
            fuentePago: paymentMethod,
            registradoPor: currentUser.uid,
            timestamp: Date.now(),
            isLoanAdvance: true,
            _lastUpdated: serverTimestamp()
        };
        await addDoc(collection(db, "gastos"), nuevoGasto);

        const nuevoPago = {
            motivo: `Préstamo: ${loan.reason.substring(0, 30)}`,
            valor: finalAmount,
            fecha: dateString,
            fuentePago: paymentMethod,
            timestamp: approvalDate.toISOString()
        };

        const batch = writeBatch(db);
        const loanDocRef = doc(db, "prestamos", loan.id);
        batch.update(loanDocRef, {
            status: 'aprobado',
            paymentMethod: paymentMethod,
            aprobadoBy: currentUser.uid,
            aprobadoDate: dateString,
            installments: installments,
            approvedAmount: finalAmount,
            internalNote: internalNote || ''
        });

        const userLoanRef = doc(collection(db, "users", loan.employeeId, "loans"), loan.id);
        batch.set(userLoanRef, {
            amount: finalAmount,
            balance: finalAmount,
            description: loan.reason,
            installments: installments,
            date: dateString,
            status: 'active',
            createdAt: serverTimestamp(),
            createdBy: currentUser.uid,
            internalNote: internalNote || ''
        });

        const userRef = doc(db, "users", loan.employeeId);
        batch.update(userRef, {
            pagos: arrayUnion(nuevoPago),
            _lastUpdated: serverTimestamp()
        });

        await batch.commit();
        hideModal();
        if (window.showToast) window.showToast("Préstamo aprobado y registrado.", 'success');
        
    } catch (error) {
        console.error("Error al aprobar préstamo:", error);
        hideModal();
        alert("Error al procesar la aprobación: " + error.message);
    }
}

async function handleLoanAction(loanId, action) {
    if (action === 'aprobado') return;
    showModalMessage("Actualizando préstamo...", true);
    try {
        if (action === 'denegado') {
            await deleteDoc(doc(db, "prestamos", loanId));
            hideModal();
            if (window.showToast) window.showToast("Solicitud de préstamo denegada y eliminada.", "success");
        } else {
            await updateDoc(doc(db, "prestamos", loanId), {
                status: action,
                [`${action}By`]: currentUser.uid,
                [`${action}Date`]: new Date().toISOString().split('T')[0]
            });
            hideModal();
            if (window.showToast) window.showToast(`Préstamo marcado como ${action}.`, "success");
        }
    } catch (error) {
        console.error(error);
        hideModal();
        alert("Error al actualizar la solicitud: " + error.message);
    }
}

// ==========================================
// 8. SUB-TAB 5: HISTORIAL GLOBAL DE PAGOS
// ==========================================

async function loadGlobalHistoryTab(container) {
    const today = new Date();
    const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];
    const todayStr = today.toISOString().split('T')[0];

    container.innerHTML = `
        <div class="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 space-y-4">
            <div class="flex flex-col md:flex-row justify-between items-end gap-4 pb-4 border-b border-slate-100">
                <div>
                    <h3 class="text-base font-bold text-slate-800">Historial Global de Pagos</h3>
                    <p class="text-xs text-slate-450 mt-1">Consulte todos los comprobantes emitidos en el periodo contable.</p>
                </div>
                <div class="flex flex-wrap sm:flex-nowrap gap-3 items-end w-full md:w-auto">
                    <div class="flex-grow sm:flex-grow-0">
                        <label class="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Desde</label>
                        <input type="date" id="global-history-start" class="border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 bg-white" value="${firstDayOfMonth}">
                    </div>
                    <div class="flex-grow sm:flex-grow-0">
                        <label class="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Hasta</label>
                        <input type="date" id="global-history-end" class="border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 bg-white" value="${todayStr}">
                    </div>
                    <button id="btn-filter-global-history" class="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black uppercase tracking-wider py-3 px-5 rounded-xl shadow-xs transition-colors shrink-0">
                        Filtrar
                    </button>
                </div>
            </div>

            <div class="overflow-hidden rounded-xl border border-slate-250 shadow-xs">
                <div class="overflow-x-auto">
                    <table class="w-full text-xs text-left">
                        <thead class="text-[10px] text-slate-400 uppercase bg-slate-50 border-b border-slate-200">
                            <tr>
                                <th class="px-4 py-3">Fecha</th>
                                <th class="px-4 py-3 font-black">Empleado</th>
                                <th class="px-4 py-3 font-black">Concepto</th>
                                <th class="px-4 py-3 text-right font-black">Monto Pagado</th>
                                <th class="px-4 py-3 text-center">Acción</th>
                            </tr>
                        </thead>
                        <tbody id="global-history-table-body" class="divide-y divide-slate-100">
                            <tr><td colspan="5" class="text-center py-8 text-slate-450 italic">Seleccione un rango y presione Filtrar.</td></tr>
                        </tbody>
                        <tfoot class="bg-slate-50/70 font-bold text-slate-800 border-t border-slate-200">
                            <tr>
                                <td colspan="3" class="px-4 py-3 text-right font-black uppercase text-[10px] text-slate-550">Total del Periodo:</td>
                                <td id="global-history-total" class="px-4 py-3 text-right font-black text-sm text-indigo-700 font-mono">$ 0</td>
                                <td></td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
                <div id="global-history-pagination" class="flex justify-between items-center bg-slate-50 border-t border-slate-200 p-3 text-xs font-semibold text-slate-500">
                    <button id="global-history-prev-btn" class="bg-white border border-slate-250 rounded-lg py-1.5 px-3 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors" disabled>&larr; Anterior</button>
                    <span id="global-history-page-info">Página 1 de 1</span>
                    <button id="global-history-next-btn" class="bg-white border border-slate-250 rounded-lg py-1.5 px-3 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors" disabled>Siguiente &rarr;</button>
                </div>
            </div>
        </div>
    `;

    const tbody = document.getElementById('global-history-table-body');
    const totalEl = document.getElementById('global-history-total');
    const btnFilter = document.getElementById('btn-filter-global-history');

    let paymentsData = [];
    let currentPage = 1;
    const itemsPerPage = 5;

    const renderPage = (page) => {
        tbody.innerHTML = '';
        const startIndex = (page - 1) * itemsPerPage;
        const endIndex = Math.min(startIndex + itemsPerPage, paymentsData.length);
        const pageItems = paymentsData.slice(startIndex, endIndex);

        if (pageItems.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" class="text-center py-8 text-slate-450 italic">No se encontraron registros de nómina en este rango.</td></tr>`;
            return;
        }

        pageItems.forEach(item => {
            const tr = document.createElement('tr');
            tr.className = "hover:bg-slate-50/50 transition-colors";
            tr.innerHTML = `
                <td class="px-4 py-3 text-slate-500 font-medium font-mono">${item.dateStr}</td>
                <td class="px-4 py-3 font-bold text-slate-800">${item.userName}</td>
                <td class="px-4 py-3 text-slate-600 font-semibold">${item.payment.concepto}</td>
                <td class="px-4 py-3 text-right font-bold text-slate-800 font-mono">${currencyFormatter.format(item.payment.monto)}</td>
                <td class="px-4 py-3 text-center">
                     <button class="view-global-voucher-btn text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 p-1.5 rounded-lg transition-all" title="Ver Comprobante">
                        <i class="fa-solid fa-file-invoice-dollar text-base"></i>
                    </button>
                </td>
            `;

            tr.querySelector('.view-global-voucher-btn').addEventListener('click', () => {
                openPaymentVoucherModal(item.payment, item.user || { firstName: 'Usuario', lastName: 'Inactivo/Eliminado', idNumber: 'N/A' });
            });

            tbody.appendChild(tr);
        });

        const totalPages = Math.ceil(paymentsData.length / itemsPerPage) || 1;
        const pageInfo = document.getElementById('global-history-page-info');
        if (pageInfo) pageInfo.textContent = `Página ${page} de ${totalPages}`;

        const prevBtn = document.getElementById('global-history-prev-btn');
        const nextBtn = document.getElementById('global-history-next-btn');
        if (prevBtn) prevBtn.disabled = (page === 1);
        if (nextBtn) nextBtn.disabled = (page === totalPages);
    };

    document.getElementById('global-history-prev-btn')?.addEventListener('click', () => {
        if (currentPage > 1) {
            currentPage--;
            renderPage(currentPage);
        }
    });

    document.getElementById('global-history-next-btn')?.addEventListener('click', () => {
        const totalPages = Math.ceil(paymentsData.length / itemsPerPage) || 1;
        if (currentPage < totalPages) {
            currentPage++;
            renderPage(currentPage);
        }
    });

    const fetchGlobalPayments = async () => {
        const start = document.getElementById('global-history-start').value;
        const end = document.getElementById('global-history-end').value;

        if (!start || !end) return;

        tbody.innerHTML = `<tr><td colspan="5" class="text-center py-10"><div class="loader-small mx-auto"></div></td></tr>`;
        paymentsData = [];
        currentPage = 1;

        try {
            const q = query(collectionGroup(db, 'paymentHistory'));
            const snapshot = await getDocs(q);

            if (snapshot.empty) {
                tbody.innerHTML = `<tr><td colspan="5" class="text-center py-8 text-slate-450 italic">No se encontraron registros de nómina en este rango.</td></tr>`;
                totalEl.textContent = "$ 0";
                
                const pageInfo = document.getElementById('global-history-page-info');
                if (pageInfo) pageInfo.textContent = `Página 1 de 1`;
                const prevBtn = document.getElementById('global-history-prev-btn');
                const nextBtn = document.getElementById('global-history-next-btn');
                if (prevBtn) prevBtn.disabled = true;
                if (nextBtn) nextBtn.disabled = true;
                return;
            }

            let totalPeriodo = 0;
            const usersMap = getUsersMap();

            snapshot.forEach(docSnap => {
                const payment = docSnap.data();
                const userId = payment.userId || docSnap.ref.parent.parent.id;
                const user = usersMap.get(userId);
                const userName = user ? `${user.firstName} ${user.lastName}` : 'Operario Desconocido';
                
                let dateStr = '';
                if (payment.paymentDate) {
                    dateStr = payment.paymentDate;
                } else if (payment.createdAt) {
                    try {
                        const d = typeof payment.createdAt.toDate === 'function' ? payment.createdAt.toDate() : new Date(payment.createdAt);
                        dateStr = d.toISOString().split('T')[0];
                    } catch (e) {
                        dateStr = '';
                    }
                }

                if (dateStr && dateStr >= start && dateStr <= end) {
                    totalPeriodo += (payment.monto || 0);
                    
                    let formattedDate = 'N/A';
                    const parts = dateStr.split('-');
                    if (parts.length === 3) {
                        formattedDate = `${parts[2]}/${parts[1]}/${parts[0]}`;
                    } else {
                        formattedDate = dateStr;
                    }

                    paymentsData.push({
                        id: docSnap.id,
                        payment: payment,
                        user: user,
                        userName: userName,
                        dateStr: formattedDate,
                        rawDate: dateStr
                    });
                }
            });

            paymentsData.sort((a, b) => b.rawDate.localeCompare(a.rawDate));

            if (paymentsData.length === 0) {
                tbody.innerHTML = `<tr><td colspan="5" class="text-center py-8 text-slate-450 italic">No se encontraron registros de nómina en este rango.</td></tr>`;
                totalEl.textContent = "$ 0";
                
                const pageInfo = document.getElementById('global-history-page-info');
                if (pageInfo) pageInfo.textContent = `Página 1 de 1`;
                const prevBtn = document.getElementById('global-history-prev-btn');
                const nextBtn = document.getElementById('global-history-next-btn');
                if (prevBtn) prevBtn.disabled = true;
                if (nextBtn) nextBtn.disabled = true;
                return;
            }

            totalEl.textContent = currencyFormatter.format(totalPeriodo);
            renderPage(currentPage);

        } catch (error) {
            console.error("Error cargando historial global:", error);
            tbody.innerHTML = `<tr><td colspan="5" class="text-center text-rose-500 py-4 font-bold">Error: ${error.message}</td></tr>`;
        }
    };

    btnFilter.addEventListener('click', fetchGlobalPayments);
    fetchGlobalPayments();
}

// ============================================================
// 9. PANEL DETALLADO DE LIQUIDACIÓN INDIVIDUAL (DRILL-DOWN)
// ============================================================

function loadIndividualDashboard(userId, defaultTab = 'nomina') {
    currentDrillDownUserId = userId;
    currentDrillDownSubTab = defaultTab;

    const dynamicContent = document.getElementById('nomina-dynamic-content');
    if (!dynamicContent) return;

    loadIndividualDashboardIntoContainer(userId, dynamicContent, defaultTab);
}

export function loadIndividualDashboardIntoContainer(userId, targetContainer, defaultTab = 'nomina', hideBackButton = false) {
    const usersMap = getUsersMap();
    const user = usersMap.get(userId);

    if (!user) {
        targetContainer.innerHTML = `<div class="p-6 text-center text-rose-500">Error: Operario no encontrado en el sistema.</div>`;
        return;
    }

    cleanupActiveDetailListeners();

    const initialLetter = ((user.firstName ? user.firstName[0] : '') + (user.lastName ? user.lastName[0] : 'E')).toUpperCase();
    const position = (user.role || 'operario').charAt(0).toUpperCase() + (user.role || 'operario').slice(1);

    targetContainer.innerHTML = `
        <div class="space-y-6">
            <div class="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div class="flex items-center gap-4 min-w-0">
                    <div class="w-12 h-12 rounded-xl bg-indigo-50 text-indigo-655 flex items-center justify-center font-black text-sm border border-indigo-150 shrink-0">
                        ${initialLetter}
                    </div>
                    <div class="min-w-0">
                        <div class="flex flex-wrap items-center gap-2">
                            <h2 class="text-base font-extrabold text-slate-800 leading-tight truncate">${user.firstName} ${user.lastName}</h2>
                            <span class="text-[9px] font-black bg-indigo-50 text-indigo-600 border border-indigo-100 px-2 py-0.5 rounded uppercase tracking-wider">${position}</span>
                        </div>
                        <p class="text-[10px] font-bold text-slate-400 mt-1 uppercase">C.C. ${user.idNumber || 'N/A'} • Cuenta ${user.bankName || 'N/A'}: <span class="font-mono">${user.accountNumber || 'N/A'}</span></p>
                    </div>
                </div>
                
                ${hideBackButton ? '' : `
                <div class="flex items-center gap-2 shrink-0">
                    <button id="btn-prev-employee" class="bg-white border border-slate-250 hover:bg-slate-50 text-slate-700 text-xs font-black uppercase tracking-wider px-3.5 py-2.5 rounded-xl transition-all shadow-xs flex items-center justify-center gap-1.5 transform active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed" title="Empleado Anterior">
                        <i class="fa-solid fa-chevron-left"></i>
                    </button>
                    <button id="btn-next-employee" class="bg-white border border-slate-250 hover:bg-slate-50 text-slate-700 text-xs font-black uppercase tracking-wider px-3.5 py-2.5 rounded-xl transition-all shadow-xs flex items-center justify-center gap-1.5 transform active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed" title="Siguiente Empleado">
                        <i class="fa-solid fa-chevron-right"></i>
                    </button>
                    <button id="btn-back-to-nomina-list" class="bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-black uppercase tracking-wider px-4 py-2.5 rounded-xl transition-all shadow-xs flex items-center justify-center gap-2 transform active:scale-95">
                        <i class="fa-solid fa-arrow-left"></i> Volver a la Lista
                    </button>
                </div>
                `}
            </div>

            <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div class="lg:col-span-2 space-y-6">
                    <div class="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                        <div class="border-b border-slate-200 bg-slate-50/70 p-1.5">
                            <nav id="payment-voucher-tabs-nav" class="flex flex-wrap md:flex-nowrap gap-1">
                                <button data-payment-tab="nomina" class="payment-subtab-btn flex-1 py-2 px-3 rounded-lg font-extrabold text-[10px] uppercase tracking-wider text-center transition-all flex items-center justify-center gap-1.5">
                                    <i class="fa-solid fa-calculator"></i> Nómina
                                </button>
                                <button data-payment-tab="prima" class="payment-subtab-btn flex-1 py-2 px-3 rounded-lg font-extrabold text-[10px] uppercase tracking-wider text-center transition-all flex items-center justify-center gap-1.5">
                                    <i class="fa-solid fa-gift"></i> Prima
                                </button>
                                <button data-payment-tab="cesantias" class="payment-subtab-btn flex-1 py-2 px-3 rounded-lg font-extrabold text-[10px] uppercase tracking-wider text-center transition-all flex items-center justify-center gap-1.5">
                                    <i class="fa-solid fa-piggy-bank"></i> Cesantías
                                </button>
                                <button data-payment-tab="vacaciones" class="payment-subtab-btn flex-1 py-2 px-3 rounded-lg font-extrabold text-[10px] uppercase tracking-wider text-center transition-all flex items-center justify-center gap-1.5">
                                    <i class="fa-solid fa-umbrella-beach"></i> Vacaciones
                                </button>
                                <button data-payment-tab="liquidacion" class="payment-subtab-btn flex-1 py-2 px-3 rounded-lg font-extrabold text-[10px] uppercase tracking-wider text-center transition-all flex items-center justify-center gap-1.5">
                                    <i class="fa-solid fa-gavel"></i> Liquidación
                                </button>
                            </nav>
                        </div>
                        <div id="payment-detail-content-area" class="p-6 md:p-8"></div>
                    </div>
                </div>

                <div class="lg:col-span-1 space-y-6">
                    <div class="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 space-y-4">
                        <div class="border-b border-slate-100 pb-3">
                            <h3 class="text-sm font-black text-slate-800 uppercase tracking-widest">Historial de Pagos</h3>
                            <p class="text-[9px] font-bold text-slate-400 mt-0.5 uppercase">Comprobantes asentados en el sistema</p>
                        </div>
                        <div class="overflow-x-auto">
                            <table class="w-full text-xs text-left">
                                <tbody id="individual-history-tbody" class="divide-y divide-slate-100">
                                    <tr><td class="text-center py-8 text-slate-450 italic">Cargando histórico...</td></tr>
                                </tbody>
                            </table>
                        </div>
                        <div id="individual-history-pagination" class="flex justify-between items-center bg-slate-50 border-t border-slate-100 p-3 rounded-b-xl text-[11px] font-semibold text-slate-500">
                            <button id="individual-history-prev-btn" class="bg-white border border-slate-200 rounded-lg py-1 px-2.5 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors" disabled>&larr; Ant</button>
                            <span id="individual-history-page-info">Pág 1 de 1</span>
                            <button id="individual-history-next-btn" class="bg-white border border-slate-200 rounded-lg py-1 px-2.5 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors" disabled>Sig &rarr;</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;

    const backBtn = document.getElementById('btn-back-to-nomina-list');
    if (backBtn) {
        backBtn.onclick = () => {
            currentDrillDownUserId = null;
            renderActiveSubTab();
        };
    }

    if (!hideBackButton) {
        const activeUsersList = Array.from(getUsersMap().values())
            .filter(u => {
                const basico = parseFloat(u.contratacion?.salario) || parseFloat(u.salarioBasico) || 0;
                return (u.status === 'active' || u.status === 'pending') && 
                       (u.role || '').toLowerCase().trim() !== 'facturador' && 
                       basico > 0;
            });
        
        const roleOrder = {
            'planta': 1,
            'facturador': 2,
            'admin': 3
        };
        
        activeUsersList.sort((a, b) => {
            const orderA = roleOrder[(a.role || '').toLowerCase().trim()] || 99;
            const orderB = roleOrder[(b.role || '').toLowerCase().trim()] || 99;
            if (orderA !== orderB) {
                return orderA - orderB;
            }
            const nameA = `${a.firstName || ''} ${a.lastName || ''}`.trim();
            const nameB = `${b.firstName || ''} ${b.lastName || ''}`.trim();
            return nameA.localeCompare(nameB, 'es');
        });

        const currentIndex = activeUsersList.findIndex(u => u.id === userId);
        const prevEmployee = currentIndex > 0 ? activeUsersList[currentIndex - 1] : null;
        const nextEmployee = currentIndex !== -1 && currentIndex < activeUsersList.length - 1 ? activeUsersList[currentIndex + 1] : null;

        const prevBtn = document.getElementById('btn-prev-employee');
        const nextBtn = document.getElementById('btn-next-employee');

        if (prevBtn) {
            if (prevEmployee) {
                prevBtn.disabled = false;
                prevBtn.onclick = () => {
                    loadIndividualDashboard(prevEmployee.id, currentDrillDownSubTab);
                };
            } else {
                prevBtn.disabled = true;
            }
        }

        if (nextBtn) {
            if (nextEmployee) {
                nextBtn.disabled = false;
                nextBtn.onclick = () => {
                    loadIndividualDashboard(nextEmployee.id, currentDrillDownSubTab);
                };
            } else {
                nextBtn.disabled = true;
            }
        }
    }

    const paymentNav = document.getElementById('payment-voucher-tabs-nav');
    const contentArea = document.getElementById('payment-detail-content-area');
    const historyTbody = document.getElementById('individual-history-tbody');

    const switchDetailTab = (type) => {
        currentDrillDownSubTab = type;
        
        paymentNav.querySelectorAll('.payment-subtab-btn').forEach(btn => {
            const isTarget = btn.dataset.paymentTab === type;
            if (isTarget) {
                btn.className = "payment-subtab-btn active flex-1 py-2 px-3 rounded-lg font-extrabold text-[10px] uppercase tracking-wider text-center transition-all bg-white shadow-xs text-indigo-700 ring-1 ring-black/5";
            } else {
                btn.className = "payment-subtab-btn flex-1 py-2 px-3 rounded-lg font-extrabold text-[10px] uppercase tracking-wider text-center transition-all text-slate-500 hover:text-slate-800 hover:bg-white/50";
            }
        });

        contentArea.innerHTML = '';
        switch (type) {
            case 'nomina':
                renderStandardPayrollForm(contentArea, user);
                break;
            case 'prima':
                renderPrimaForm(contentArea, user);
                break;
            case 'cesantias':
                renderCesantiasForm(contentArea, user);
                break;
            case 'vacaciones':
                renderVacacionesForm(contentArea, user);
                break;
            case 'liquidacion':
                renderLiquidacionForm(contentArea, user);
                break;
        }
    };

    paymentNav.addEventListener('click', (e) => {
        const btn = e.target.closest('.payment-subtab-btn');
        if (btn) switchDetailTab(btn.dataset.paymentTab);
    });

    switchDetailTab(defaultTab);
    loadPaymentHistoryList(userId, historyTbody, user);
}

// ==========================================
// 15. MODAL DE COMPROBANTE DE PAGO (VOUCHER)
// ==========================================

async function openPaymentVoucherModal(payment, user) {
    const modal = document.getElementById('payment-voucher-modal');
    const earningsList = document.getElementById('voucher-earnings-list');
    const deductionsList = document.getElementById('voucher-deductions-list');

    if (!modal) return;

    const modalBody = modal.querySelector('.p-8') || modal.querySelector('.bg-white');
    const existingDynamic = document.getElementById('voucher-dynamic-header');
    if (existingDynamic) existingDynamic.remove();

    const oldSigs = document.getElementById('voucher-dynamic-signatures');
    if (oldSigs) oldSigs.remove();
    
    const oldDateEl = document.getElementById('voucher-date');
    if (oldDateEl) oldDateEl.innerHTML = '';
    
    const oldContractDates = document.getElementById('voucher-contract-dates');
    if (oldContractDates) oldContractDates.remove();

    modalBody.querySelectorAll('h3, h2').forEach(el => {
        if (el.textContent.includes('Comprobante') || (el.id !== 'voucher-concept' && el.id !== 'voucher-employee-name')) {
             if (!el.id) el.style.display = 'none'; 
        }
    });

    let title = 'COMPROBANTE DE NÓMINA';
    let subtitle = 'Pago Periódico';
    let themeColor = 'text-blue-600';
    let themeBg = 'bg-blue-50';
    let themeBorder = 'border-blue-200';
    let icon = 'fa-money-check-dollar';

    const concepto = (payment.concepto || '').toLowerCase();

    if (concepto.includes('prima')) {
        title = 'PRIMA DE SERVICIOS';
        subtitle = 'Prestación Social';
        themeColor = 'text-indigo-700';
        themeBg = 'bg-indigo-50';
        themeBorder = 'border-indigo-200';
        icon = 'fa-gift';
    } else if (concepto.includes('cesant')) {
        title = 'CESANTÍAS (FONDO)';
        subtitle = 'Liquidación Anual';
        themeColor = 'text-emerald-700';
        themeBg = 'bg-emerald-50';
        themeBorder = 'border-emerald-200';
        icon = 'fa-piggy-bank';
    } else if (concepto.includes('vacaciones')) {
        title = 'COMPROBANTE DE VACACIONES';
        subtitle = 'Novedad de Nómina';
        themeColor = 'text-cyan-700';
        themeBg = 'bg-cyan-50';
        themeBorder = 'border-cyan-200';
        icon = 'fa-umbrella-beach';
    } else if (concepto.includes('liquidaci')) {
        title = 'LIQUIDACIÓN FINAL';
        subtitle = 'Cierre de Contrato';
        themeColor = 'text-red-700';
        themeBg = 'bg-red-50';
        themeBorder = 'border-red-200';
        icon = 'fa-door-open';
    }

    let dateObj = new Date();
    if (payment.paymentDate) {
        dateObj = new Date(payment.paymentDate + 'T00:00:00');
    } else if (payment.createdAt) {
        if (typeof payment.createdAt.toDate === 'function') {
            dateObj = payment.createdAt.toDate();
        } else if (payment.createdAt.seconds) {
            dateObj = new Date(payment.createdAt.seconds * 1000);
        } else {
            dateObj = new Date(payment.createdAt);
        }
    }

    const dateStr = dateObj.toLocaleDateString('es-CO', { year: 'numeric', month: 'short', day: 'numeric' });

    let companyName = "Empresa";
    let companyNit = "";
    let companyLogo = null;
    let managerSignature = null;

    try {
        if (window.companyHeaderCache) {
            companyName = window.companyHeaderCache.nombre;
            companyNit = window.companyHeaderCache.nit;
            companyLogo = window.companyHeaderCache.logo;
            managerSignature = window.companyHeaderCache.signature;
        } else {
            const snap = await getDoc(doc(db, "config", "general"));
            if(snap.exists()) {
                const data = snap.data();
                const emp = data.empresa || {}; 
                companyName = emp.nombre || companyName;
                companyNit = emp.nit ? `NIT: ${emp.nit}` : "";
                companyLogo = emp.logoURL || data.logoURL || emp.empresaLogoURL || data.empresaLogoURL || emp.logo || null;
                managerSignature = emp.firmaGerenteURL || data.firmaGerenteURL || emp.empresaFirmaURL || data.empresaFirmaURL || null;
                window.companyHeaderCache = { nombre: companyName, nit: companyNit, logo: companyLogo, signature: managerSignature };
            }
        }
    } catch(e) { console.log("Error config", e); }

    const sidebarLogo = document.querySelector('#desktop-sidebar img')?.getAttribute('src');
    const mobileLogo = document.querySelector('#mobile-header img')?.getAttribute('src');
    const authLogo = document.querySelector('#auth-view img')?.getAttribute('src');
    const defaultLogo = '/app/recursos/LOGO PRISMA.png';
    const resolvedPageLogo = sidebarLogo || mobileLogo || authLogo || defaultLogo;
    const activeLogo = companyLogo || resolvedPageLogo;

    let visualElementHtml = '';
    if (activeLogo) {
        visualElementHtml = `<div class="mb-4 flex justify-center"><img src="${activeLogo}" alt="Logo" class="h-24 w-auto object-contain p-1 bg-white"></div>`;
    } else {
        visualElementHtml = `<div class="flex justify-center mb-3"><div class="w-14 h-14 ${themeBg} rounded-full flex items-center justify-center ${themeColor} text-2xl shadow-sm border-2 ${themeBorder}"><i class="fa-solid ${icon}"></i></div></div>`;
    }

    const headerDiv = document.createElement('div');
    headerDiv.id = 'voucher-dynamic-header';
    headerDiv.className = `text-center mb-6 pb-4 border-b-2 border-dashed ${themeBorder}`;
    headerDiv.innerHTML = `${visualElementHtml}<h2 class="text-xl font-black text-slate-800 uppercase tracking-tight leading-none mb-1">${companyName}</h2><p class="text-xs text-slate-500 font-mono mb-4">${companyNit}</p><div class="flex flex-wrap justify-center items-center gap-3"><div class="inline-block ${themeBg} ${themeColor} px-4 py-1.5 rounded-lg border ${themeBorder} shadow-xs"><p class="text-xs font-bold uppercase tracking-widest">${title}</p></div><div class="h-8 w-px bg-gray-300 hidden sm:block"></div><div class="text-left bg-gray-50 px-3 py-1 rounded border border-gray-100"><p class="text-[9px] text-gray-400 uppercase leading-none font-bold">Fecha de Emisión</p><p class="text-xs font-bold text-gray-700 leading-tight mt-0.5">${dateStr}</p></div></div><p class="text-[10px] text-gray-450 mt-2 uppercase tracking-wide font-semibold">${subtitle}</p>`;
    
    if (modalBody.firstChild) modalBody.insertBefore(headerDiv, modalBody.firstChild);

    document.getElementById('voucher-employee-name').textContent = `${user.firstName} ${user.lastName}`;
    document.getElementById('voucher-employee-id').textContent = user.idNumber ? `CC: ${user.idNumber}` : '';
    document.getElementById('voucher-concept').textContent = payment.concepto;
    
    const totalEl = document.getElementById('voucher-total');
    totalEl.textContent = currencyFormatter.format(payment.monto);
    totalEl.className = `text-3xl font-black ${themeColor}`;

    const parseMoney = (val) => {
        if (!val) return 0;
        if (typeof val === 'number') return val;
        return parseFloat(String(val).replace(/[$. \u00A0]/g, '').replace(',', '.')) || 0;
    };

    const createRow = (label, val, isBold = false, formula = '') => {
        const displayVal = typeof val === 'number' ? currencyFormatter.format(val) : val;
        let formulaHtml = formula ? `<div class="text-[9px] text-gray-400 mt-0.5 italic tracking-tight">${formula}</div>` : '';
        return `<li class="flex justify-between items-start py-2 border-b border-gray-55 last:border-0 text-sm">
            <div class="flex flex-col pr-2">
                <span class="${isBold ? 'font-bold text-gray-700' : 'text-gray-550'} leading-tight">${label}</span>
                ${formulaHtml}
            </div>
            <span class="font-bold text-gray-800 whitespace-nowrap">${displayVal}</span>
        </li>`;
    };
    
    earningsList.innerHTML = '';
    deductionsList.innerHTML = '';
    const det = payment.details || {};
    const d = payment.desglose || {};

    if (concepto.includes('liquidaci') && det.fechaIngreso && det.fechaRetiro) {
        const datesDiv = document.createElement('div');
        datesDiv.id = 'voucher-contract-dates';
        datesDiv.className = "mb-6 grid grid-cols-2 gap-4 bg-gray-50 p-3 rounded-xl border border-gray-100";
        datesDiv.innerHTML = `
            <div class="text-center border-r border-gray-200"><p class="text-[10px] text-gray-400 uppercase font-bold">Inicio Contrato</p><p class="text-sm font-bold text-gray-800">${det.fechaIngreso}</p></div>
            <div class="text-center"><p class="text-[10px] text-gray-400 uppercase font-bold">Fecha Retiro</p><p class="text-sm font-bold text-gray-800">${det.fechaRetiro}</p></div>
        `;
        const empBlock = document.getElementById('voucher-employee-name').parentElement.parentElement;
        empBlock.insertAdjacentElement('afterend', datesDiv);
    }

    if (concepto.includes('prima')) {
        const base = parseFloat(det.baseCalculo) || 0;
        const dias = parseFloat(det.diasSemestre) || 0;
        const primaBruta = (base * dias) / 360;
        earningsList.innerHTML += createRow('Valor Prima (Bruta)', primaBruta, true);
        if (det.rangoFechas) earningsList.innerHTML += createRow('Periodo', det.rangoFechas);
        if (det.diasSemestre) earningsList.innerHTML += createRow('Días Liquidados', `${det.diasSemestre}`);
        if (det.baseCalculo) earningsList.innerHTML += createRow('Base Promedio', det.baseCalculo);
        if (det.descuentoPrestamos > 0) {
            deductionsList.innerHTML += createRow('Descuento Préstamos', det.descuentoPrestamos, true);
        } else {
            deductionsList.innerHTML = '<li class="text-xs text-gray-300 text-center py-2 italic">Sin deducciones</li>';
        }

    } else if (concepto.includes('cesant')) {
        earningsList.innerHTML += createRow('Valor Fondo', payment.monto, true);
        if (det.periodo) earningsList.innerHTML += createRow('Periodo', det.periodo);
        if (det.base) earningsList.innerHTML += createRow('Base', det.base);
        if (det.dias) earningsList.innerHTML += createRow('Días', `${det.dias}`);
        if (det.interesesCalculados) {
             earningsList.innerHTML += `<li class="mt-2 p-2 bg-yellow-50 text-xs text-center text-yellow-800 rounded border border-yellow-100">Intereses (12%): <strong>${currencyFormatter.format(det.interesesCalculados)}</strong><br>(Pagados directamente)</li>`;
        }
        deductionsList.innerHTML = '<li class="text-xs text-gray-300 text-center py-2 italic">Consignación Fondo</li>';

    } else if (concepto.includes('vacaciones')) {
        earningsList.innerHTML += createRow('Pago Vacaciones', payment.monto, true);
        if (det.diasPagados) earningsList.innerHTML += createRow('Días Pagados', `${det.diasPagados} días`);
        if (det.tipoVacaciones) {
            const labelTipo = det.tipoVacaciones === 'dinero' ? 'Compensadas en Dinero' : 'Disfrute (Tiempo)';
            earningsList.innerHTML += createRow('Modalidad', labelTipo);
        }
        if (det.periodoNota) earningsList.innerHTML += createRow('Nota', det.periodoNota);
        deductionsList.innerHTML = '<li class="text-xs text-gray-300 text-center py-2 italic">Sin deducciones</li>';

    } else if (concepto.includes('liquidaci')) {
        const baseP = det.basePrestacional ? currencyFormatter.format(det.basePrestacional) : 'Base';
        const baseS = det.baseSalarial ? currencyFormatter.format(det.baseSalarial) : 'Salario';
        const dias = det.diasLiquidados || 'Días';

        if(det.cesantias && parseMoney(det.cesantias) > 0) 
            earningsList.innerHTML += createRow('Cesantías', det.cesantias, false, `${baseP} x ${dias} / 360`);
        if(det.intereses && parseMoney(det.intereses) > 0) 
            earningsList.innerHTML += createRow('Intereses Cesantías', det.intereses, false, `12% sobre Cesantías`);
        if(det.prima && parseMoney(det.prima) > 0) 
            earningsList.innerHTML += createRow('Prima Servicios', det.prima, false, `Proporcional`);
        if(det.vacaciones && parseMoney(det.vacaciones) > 0) 
            earningsList.innerHTML += createRow('Vacaciones', det.vacaciones, false, `${baseS} x Días Pend. / 720`);
        if(parseMoney(det.indemnizacion) > 0) 
            earningsList.innerHTML += createRow('Indemnización', det.indemnizacion, true, 'Despido sin justa causa');

        let totalDed = 0;
        if(det.deducciones) totalDed += parseMoney(det.deducciones);
        if(totalDed > 0) deductionsList.innerHTML += createRow('Préstamos Pendientes', totalDed, true);
        else deductionsList.innerHTML = '<li class="text-xs text-gray-300 text-center py-2 italic">Sin deducciones</li>';

    } else {
        let displaySalario = d.salarioProrrateado;
        let displayBonificacion = d.bonificacionM2 || 0;
        let labelSalario = `Salario Básico (${payment.diasPagados} días)`;

        if (d.deduccionSobreMinimo && d.baseDeduccion > 0) {
             if (displaySalario > d.baseDeduccion) {
                const excedente = displaySalario - d.baseDeduccion;
                displaySalario = d.baseDeduccion; 
                labelSalario = `Salario Básico (Min. Legal)`;
                displayBonificacion += excedente; 
            }
        }

        if (displaySalario > 0) earningsList.innerHTML += createRow(labelSalario, displaySalario);
        if (d.auxilioTransporteProrrateado > 0) {
            const diasAux = payment.diasAuxTransporte !== undefined ? payment.diasAuxTransporte : (d.diasAuxTransporte !== undefined ? d.diasAuxTransporte : payment.diasPagados);
            earningsList.innerHTML += createRow(`Aux. Transporte (${diasAux} días)`, d.auxilioTransporteProrrateado);
        }
        if (d.horasExtra > 0) earningsList.innerHTML += createRow('Horas Extra', d.horasExtra);
        if (displayBonificacion > 0) {
            const labelBono = (d.deduccionSobreMinimo) ? 'Bonificación / Aux. No Salarial' : 'Bonificación';
            earningsList.innerHTML += createRow(labelBono, displayBonificacion, true);
        }
        if (d.otros) earningsList.innerHTML += createRow('Otros', d.otros);

        if (d.deduccionSalud) deductionsList.innerHTML += createRow('Salud', Math.abs(d.deduccionSalud));
        if (d.deduccionPension) deductionsList.innerHTML += createRow('Pensión', Math.abs(d.deduccionPension));
        if (d.abonoPrestamos) deductionsList.innerHTML += createRow('Préstamos', d.abonoPrestamos);
        if (d.otros < 0) deductionsList.innerHTML += createRow('Otras', Math.abs(d.otros));
    }

    const signaturesDiv = document.createElement('div');
    signaturesDiv.id = 'voucher-dynamic-signatures';
    signaturesDiv.className = "mt-12 flex justify-between text-center items-end px-6";
    
    let managerSigHtml = '<div class="h-16 w-full"></div>';
    if (managerSignature) {
        managerSigHtml = `<img src="${managerSignature}" alt="Firma" class="h-16 w-auto object-contain mx-auto mb-1">`;
    }

    const formattedCompanyName = companyName.toLowerCase().split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

    signaturesDiv.innerHTML = `
        <div class="w-[40%] flex flex-col justify-end">
            ${managerSigHtml}
            <div class="border-t border-slate-350 mb-2 w-full"></div>
            <p class="text-[10px] font-black text-slate-500 uppercase tracking-wider">FIRMA EMPRESA</p>
            <p class="text-[8px] font-bold text-slate-400 mt-0.5 uppercase">${formattedCompanyName}</p>
        </div>
        <div class="w-[40%] flex flex-col justify-end">
            <div class="h-16 w-full"></div>
            <div class="border-t border-slate-350 mb-2 w-full"></div>
            <p class="text-[10px] font-black text-slate-500 uppercase tracking-wider">RECIBÍ CONFORME</p>
            <p class="text-[8px] font-bold text-slate-400 mt-0.5">C.C. ${user.idNumber || '---'}</p>
        </div>
    `;
    modalBody.appendChild(signaturesDiv);

    modal.classList.remove('hidden');
    modal.style.display = 'flex';

    const closeModal = () => { modal.style.display = 'none'; };
    const btnX = document.getElementById('voucher-close-btn');
    const btnF = document.getElementById('voucher-close-footer-btn');
    
    if(btnX) { const n = btnX.cloneNode(true); btnX.parentNode.replaceChild(n, btnX); n.onclick = closeModal; }
    if(btnF) { const n = btnF.cloneNode(true); btnF.parentNode.replaceChild(n, btnF); n.onclick = closeModal; }
}


// ==========================================
// LOCAL HELPERS FOR EXTRACTED PAYROLL FORMS
// ==========================================
let unsubscribeEmpleadosTab = null;

function _openConfirmModal(message, onConfirm) {
    if (window.openConfirmModal) {
        window.openConfirmModal(message, onConfirm);
    } else if (confirm(message)) {
        onConfirm();
    }
}

// ==========================================
// EXTRACTED: renderStandardPayrollForm
// ==========================================
async function renderStandardPayrollForm(container, user) {
    const salarioBasico = parseFloat(user.contratacion?.salario) || parseFloat(user.salarioBasico) || 0;
    container.innerHTML = `
        <form id="payment-register-form" class="space-y-8" data-deduccion-sobre-minimo="${user.deduccionSobreMinimo || false}">
            <div class="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6">
                <div>
                    <label class="block text-xs font-bold text-gray-500 uppercase mb-2">Periodo</label>
                    <div class="relative">
                        <select id="payment-concepto" class="w-full border border-gray-300 rounded-lg p-3 text-sm font-medium bg-gray-50 focus:bg-white transition-colors cursor-pointer outline-none focus:ring-2 focus:ring-indigo-500"></select>
                    </div>
                </div>
                <div>
                    <label class="block text-xs font-bold text-gray-500 uppercase mb-2">Días Salario</label>
                    <div class="flex items-center gap-2">
                        <input type="number" id="payment-dias-pagar" class="payment-dias-input w-20 border border-gray-300 rounded-lg p-3 text-center font-bold text-gray-700 outline-none focus:ring-2 focus:ring-indigo-500" value="15" min="0" max="30">
                        <span id="payment-salario-basico" class="text-xs font-bold text-gray-400 bg-gray-100 px-3 py-3 rounded-lg text-center border border-gray-200 flex-grow font-mono" 
                            data-value="${salarioBasico}" 
                            data-aux-transporte="${salarioBasico <= (getPayrollConfig()?.salarioMinimo * 2) ? (getPayrollConfig()?.auxilioTransporte || 0) : 0}">
                            ${currencyFormatter.format(salarioBasico)}
                        </span>
                    </div>
                </div>
                <div>
                    <label class="block text-xs font-bold text-gray-500 uppercase mb-2">Días Aux. Transp.</label>
                    <div class="flex items-center gap-2">
                        <input type="number" id="payment-dias-aux-transporte" class="payment-dias-input w-20 border border-gray-300 rounded-lg p-3 text-center font-bold text-gray-700 outline-none focus:ring-2 focus:ring-indigo-500" value="${user.incapacitado ? 0 : (salarioBasico <= (getPayrollConfig()?.salarioMinimo * 2) ? 15 : 0)}" min="0" max="30">
                        <span id="payment-aux-transporte-valor" class="text-xs font-bold text-gray-400 bg-gray-100 px-3 py-3 rounded-lg text-center border border-gray-200 flex-grow font-mono">
                            Aux: ${currencyFormatter.format(salarioBasico <= (getPayrollConfig()?.salarioMinimo * 2) ? (getPayrollConfig()?.auxilioTransporte || 0) : 0)}
                        </span>
                    </div>
                </div>
            </div>

             <div>
                <h4 class="text-xs font-black text-emerald-600 uppercase tracking-widest mb-4 border-b border-emerald-100 pb-1 w-fit">Ingresos Adicionales</h4>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <div class="space-y-2 hidden" style="display: none !important;">
                        <div class="flex items-center gap-2">
                            <input type="checkbox" id="payment-liquidar-bonificacion" class="w-4 h-4 text-emerald-600 rounded cursor-pointer focus:ring-emerald-500">
                            <label for="payment-liquidar-bonificacion" class="text-sm font-bold text-gray-700 cursor-pointer select-none">Pagar Bonificación</label>
                        </div>
                        <p id="payment-bonificacion-mes" class="text-sm font-mono text-gray-500 pl-6" data-value="0">$ 0</p>
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-gray-500 uppercase mb-2">Horas Extra (Cant.)</label>
                        <div class="flex items-center gap-2">
                            <input type="number" id="payment-horas-diurnas" class="payment-horas-input w-20 border border-gray-300 rounded-lg p-3 text-center text-sm focus:ring-indigo-500 focus:border-indigo-500 outline-none" placeholder="0" min="0">
                            <span id="payment-total-horas" class="text-sm font-bold text-gray-600 font-mono flex-grow text-right bg-gray-50 p-3 rounded-lg border border-gray-200">$ 0</span>
                        </div>
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-gray-500 uppercase mb-2">Otros</label>
                        <input type="text" id="payment-otros" class="currency-input w-full border border-gray-300 rounded-lg p-3 text-right font-mono text-sm focus:ring-indigo-500 focus:border-indigo-500 outline-none" placeholder="$ 0">
                    </div>
                </div>
            </div>

            <div id="deductions-container-wrapper" class="bg-red-50/50 rounded-xl p-5 border border-red-100">
                 <h4 class="text-xs font-black text-rose-600 uppercase tracking-widest mb-4 border-b border-rose-100 pb-1 w-fit">Deducciones</h4>
                 <div id="loan-management-fieldset-placeholder"></div>
            </div>

            <div class="bg-slate-800 text-white p-6 rounded-xl shadow-lg flex justify-between items-center transform transition-transform hover:scale-[1.01]">
                <div>
                    <p class="text-slate-400 text-xs font-bold uppercase tracking-wider">Neto a Pagar</p>
                </div>
                <div class="text-right">
                    <p id="payment-total-pagar" class="text-4xl font-black tracking-tight text-white">$ 0</p>
                </div>
            </div>

            <div class="flex justify-end">
                <button type="submit" id="payment-submit-button" class="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-8 rounded-xl shadow-md transition-all flex items-center gap-2">
                    <i class="fa-solid fa-floppy-disk"></i> Registrar Nómina
                </button>
            </div>
        </form>
    `;

    // 1. Cargar Préstamos
    await loadActiveLoansForForm(user.id);
    
    // 2. Configurar Bonificación (Stats)
    const today = new Date();
    const currentStatDocId = `${today.getFullYear()}_${String(today.getMonth() + 1).padStart(2, '0')}`;
    const statRef = doc(db, "employeeStats", user.id, "monthlyStats", currentStatDocId);
    
    // Default bonif
    const bonifEl = document.getElementById('payment-bonificacion-mes');
    const chk = document.getElementById('payment-liquidar-bonificacion');
    
    try {
        const statSnap = await getDoc(statRef);
        let bonifVal = 0;
        if(statSnap.exists()) {
            bonifVal = statSnap.data().totalBonificacion || 0;
            const pagada = statSnap.data().bonificacionPagada || false;
            bonifEl.dataset.value = bonifVal;
            
            if(pagada) {
                bonifEl.textContent = currencyFormatter.format(bonifVal) + " (Pagada)";
                bonifEl.classList.add('line-through', 'text-gray-400');
                chk.disabled = true;
                chk.checked = false;
            } else {
                bonifEl.textContent = currencyFormatter.format(bonifVal);
                chk.checked = false; 
            }
        }
    } catch(e) { console.warn("No stats yet"); }

    // 3. Rellenar Select de Periodo (Opciones Inteligentes)
    const conceptoSelect = document.getElementById('payment-concepto');
    const months = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    const currentMonth = months[today.getMonth()];
    const year = today.getFullYear();
    
    // Consulta inteligente de historial para sugerir el siguiente periodo contable
    let suggestedConcept = null;
    try {
        const qLast = query(
            collection(db, "users", user.id, "paymentHistory"),
            orderBy("createdAt", "desc"),
            limit(1)
        );
        const lastSnap = await getDocs(qLast);
        if (!lastSnap.empty) {
            const lastPayment = lastSnap.docs[0].data();
            suggestedConcept = getNextPeriodSuggestion(lastPayment.concepto);
        }
    } catch(e) {
        console.warn("Error al sugerir periodo desde historial", e);
    }
    
    let suggestedOptionHtml = '';
    if (suggestedConcept) {
        const defaultOptions = [
            `Primera Quincena de ${currentMonth} ${year}`,
            `Segunda Quincena de ${currentMonth} ${year}`,
            `Nómina Mensual ${currentMonth} ${year}`
        ];
        
        if (!defaultOptions.includes(suggestedConcept)) {
            let shortLabel = suggestedConcept;
            if (suggestedConcept.includes('Primera Quincena')) {
                shortLabel = `1ª Quincena - ${suggestedConcept.replace('Primera Quincena de ', '')} (Sugerida)`;
            } else if (suggestedConcept.includes('Segunda Quincena')) {
                shortLabel = `2ª Quincena - ${suggestedConcept.replace('Segunda Quincena de ', '')} (Sugerida)`;
            } else if (suggestedConcept.includes('Nómina Mensual')) {
                shortLabel = `Mes Completo - ${suggestedConcept.replace('Nómina Mensual ', '')} (Sugerido)`;
            }
            suggestedOptionHtml = `<option value="${suggestedConcept}" selected>${shortLabel}</option>`;
        }
    }
    
    conceptoSelect.innerHTML = `
        ${suggestedOptionHtml}
        <option value="Primera Quincena de ${currentMonth} ${year}">1ª Quincena - ${currentMonth}</option>
        <option value="Segunda Quincena de ${currentMonth} ${year}">2ª Quincena - ${currentMonth}</option>
        <option value="Nómina Mensual ${currentMonth} ${year}">Mes Completo</option>
    `;

    // Pre-selección inteligente
    if (suggestedConcept) {
        conceptoSelect.value = suggestedConcept;
    } else {
        const dayOfMonth = today.getDate();
        if (dayOfMonth > 15) {
            conceptoSelect.value = `Segunda Quincena de ${currentMonth} ${year}`;
        }
    }

    // Configurar días iniciales según la opción pre-seleccionada
    const daysInput = document.getElementById('payment-dias-pagar');
    const transportDaysInput = document.getElementById('payment-dias-aux-transporte');
    const initialVal = conceptoSelect.value;
    let initialD = 15;
    if (initialVal.includes('Mensual') || initialVal.includes('Completo')) {
        initialD = 30;
    }
    daysInput.value = initialD;
    
    let initialIncDays = 0;
    const initialRange = getQuincenaPeriodFromConcept(initialVal);
    if (initialRange) {
        initialIncDays = getIncapacitatedDaysInPeriod(user, initialRange.startDate, initialRange.endDate);
    } else if (user.incapacitado) {
        initialIncDays = initialD;
    }
    transportDaysInput.value = Math.max(0, initialD - initialIncDays);

    // --- LISTENER PARA CAMBIAR DÍAS AUTOMÁTIMAMENTE ---
    conceptoSelect.addEventListener('change', function() {
        const val = this.value;
        
        let d = 15;
        if (val.includes('Mensual') || val.includes('Completo')) {
            d = 30; // Siempre 30, incluso en Febrero
        } else if (val.includes('Segunda')) {
            d = 15; // La 2da quincena siempre cierra el mes contable de 30
        } else {
            d = 15; // 1ra quincena siempre es 15
        }
        
        daysInput.value = d;
        
        let changeIncDays = 0;
        const changeRange = getQuincenaPeriodFromConcept(val);
        if (changeRange) {
            changeIncDays = getIncapacitatedDaysInPeriod(user, changeRange.startDate, changeRange.endDate);
        } else if (user.incapacitado) {
            changeIncDays = d;
        }
        transportDaysInput.value = Math.max(0, d - changeIncDays);
        
        // Importante: Recalcular totales inmediatamente
        updatePaymentTotal();
    });

    // Sincronización automática de Días Aux. Transp. al modificar Días Salario
    daysInput.addEventListener('input', function() {
        let currentIncDays = 0;
        const val = conceptoSelect.value;
        const range = getQuincenaPeriodFromConcept(val);
        const inputVal = parseInt(this.value) || 0;
        if (range) {
            currentIncDays = getIncapacitatedDaysInPeriod(user, range.startDate, range.endDate);
        } else if (user.incapacitado) {
            currentIncDays = inputVal;
        }
        transportDaysInput.value = Math.max(0, inputVal - currentIncDays);
    });

    // 4. Listeners Generales
    const form = document.getElementById('payment-register-form');
    
    // Listener unificado para inputs que afectan el cálculo
    form.addEventListener('input', (e) => {
        // Si es el input de horas extra, validar negativos en tiempo real
        if (e.target.id === 'payment-horas-diurnas') {
            if (e.target.value < 0) e.target.value = 0;
        }
        updatePaymentTotal();
    });
    
    form.addEventListener('change', (e) => { // Para checkbox y select
        updatePaymentTotal();
    });

    form.addEventListener('submit', (e) => handleRegisterPayment(e, user.id));
    
    // 5. Setup Inputs Moneda
    form.querySelectorAll('.currency-input').forEach(setupCurrencyInput);
    
    // Cálculo inicial
    updatePaymentTotal();
}
// --- B. FORMULARIO PRIMA DE SERVICIOS (CON FECHAS EXACTAS PARA EL RECIBO) ---

// ==========================================
// EXTRACTED: renderPrimaForm
// ==========================================
async function renderPrimaForm(container, user) {
    const currentYear = new Date().getFullYear();
    const baseInfo = calculateBaseForBenefits(user);
    
    // 1. Obtener Fechas Reales del Contrato
    const startDate = getEmployeeStartDate(user);
    
    let endDate = null;
    if (user.contractEndDate) {
        endDate = (typeof user.contractEndDate.toDate === 'function') 
            ? user.contractEndDate.toDate() 
            : new Date(user.contractEndDate);
    }

    const startDateStr = startDate.toLocaleDateString('es-CO', { year: 'numeric', month: 'short', day: 'numeric' });
    
    const badgeHtml = baseInfo.isMinimum 
        ? `<span class="bg-orange-100 text-orange-800 text-[10px] font-bold px-2 py-1 rounded border border-orange-200 block mt-1"><i class="fa-solid fa-triangle-exclamation mr-1"></i>Ajustado a Mínimo</span>`
        : `<span class="bg-blue-50 text-blue-700 text-[10px] font-bold px-2 py-1 rounded border border-blue-200 block mt-1">${baseInfo.label}</span>`;

    container.innerHTML = `
        <form id="prima-form" class="space-y-6">
            <div class="bg-indigo-50 border-l-4 border-indigo-500 p-4 rounded-r-lg flex justify-between items-center">
                <div>
                    <h4 class="font-bold text-indigo-900">Prima de Servicios</h4>
                    <p class="text-sm text-indigo-700">Calculada según fechas de contrato.</p>
                </div>
                <div class="text-right text-xs">
                    <p class="text-indigo-500 font-bold uppercase">Inicio Contrato</p>
                    <p class="font-mono font-bold text-indigo-800">${startDateStr}</p>
                </div>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
                <div>
                    <label class="block text-xs font-bold text-gray-500 uppercase mb-2">Periodo a Liquidar</label>
                    <select id="prima-periodo-select" class="w-full border-gray-300 rounded-lg p-3 text-sm font-bold text-gray-700 focus:ring-indigo-500 cursor-pointer bg-white shadow-sm">
                        <option value="1">1° Semestre (Ene - Jun) ${currentYear}</option>
                        <option value="2">2° Semestre (Jul - Dic) ${currentYear}</option>
                    </select>
                </div>
                <div>
                    <label class="block text-xs font-bold text-gray-500 uppercase mb-2">Base Salarial Promedio</label>
                    <input type="text" id="prima-base" class="currency-input w-full border-gray-300 rounded-lg p-3 font-bold text-right focus:ring-indigo-500" value="${currencyFormatter.format(baseInfo.value)}">
                    ${badgeHtml}
                </div>
                <div>
                    <label class="block text-xs font-bold text-gray-500 uppercase mb-2">Días a Pagar</label>
                    <input type="number" id="prima-dias" class="w-full border-gray-300 rounded-lg p-3 font-bold text-center focus:ring-indigo-500 bg-gray-50" readonly>
                    <p id="prima-dias-info" class="text-[10px] text-gray-400 mt-1 italic text-right"></p>
                </div>
                <div class="flex flex-col justify-end">
                    <div class="bg-white border-2 border-indigo-100 p-4 rounded-xl text-right shadow-sm">
                        <p class="text-xs text-indigo-400 font-bold uppercase tracking-wider">Total Prima (Bruta)</p>
                        <p id="prima-total" class="text-2xl font-black text-indigo-700">$ 0</p>
                    </div>
                </div>
            </div>

            <div id="prima-loan-management-placeholder" class="bg-red-50/50 rounded-xl p-5 border border-red-100">
            </div>

            <div class="bg-slate-800 text-white p-6 rounded-xl shadow-lg flex justify-between items-center transform transition-transform hover:scale-[1.01]">
                <div>
                    <p class="text-slate-400 text-xs font-bold uppercase tracking-wider">Neto a Pagar</p>
                </div>
                <div class="text-right">
                    <p id="prima-neto-pagar" class="text-4xl font-black tracking-tight text-white">$ 0</p>
                </div>
            </div>

            <div class="flex justify-end pt-4">
                <button type="submit" id="prima-submit-button" class="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 px-8 rounded-xl shadow-md transition-all flex items-center">
                    <i class="fa-solid fa-gift mr-2"></i> Registrar Pago de Prima
                </button>
            </div>
        </form>
    `;

    const inputBase = document.getElementById('prima-base');
    const inputDias = document.getElementById('prima-dias');
    const totalEl = document.getElementById('prima-total');
    const selectPeriodo = document.getElementById('prima-periodo-select');
    const diasInfo = document.getElementById('prima-dias-info');

    setupCurrencyInput(inputBase);
    const currentMonth = new Date().getMonth();
    if (currentMonth > 5) selectPeriodo.value = "2";

    // Variables para guardar el rango exacto
    let currentRange = { start: null, end: null };

    const calculateDays = () => {
        const semestre = selectPeriodo.value; 
        const year = currentYear;
        
        let startPeriod, endPeriod;
        if (semestre === "1") {
            startPeriod = new Date(year, 0, 1); // 1 Ene
            endPeriod = new Date(year, 5, 30);  // 30 Jun
        } else {
            startPeriod = new Date(year, 6, 1); // 1 Jul
            endPeriod = new Date(year, 11, 30); // 30 Dic
        }
        
        startPeriod.setHours(0,0,0,0);
        endPeriod.setHours(23,59,59,999);
        const startContract = new Date(startDate); startContract.setHours(0,0,0,0);
        
        if (startContract > endPeriod) {
            inputDias.value = 0;
            diasInfo.textContent = "Contrato posterior al periodo.";
            currentRange = { start: null, end: null };
            calcTotal();
            return;
        }

        // Inicio efectivo:
        let effectiveStart = startContract > startPeriod ? startContract : startPeriod;

        // Fin efectivo:
        let effectiveEnd = endPeriod;
        if (endDate) {
            const endContract = new Date(endDate); endContract.setHours(23,59,59,999);
            if (endContract < startPeriod) {
                inputDias.value = 0;
                diasInfo.textContent = "Contrato finalizado antes.";
                currentRange = { start: null, end: null };
                calcTotal();
                return;
            }
            if (endContract < endPeriod) effectiveEnd = endContract;
        }

        // Guardamos las fechas exactas para enviarlas al guardar
        currentRange = { start: effectiveStart, end: effectiveEnd };

        // --- CAMBIO: USAR CÁLCULO 360 DÍAS ---
        let days = calculateDays360(effectiveStart, effectiveEnd); 
        
        // Ajuste: Si el cálculo da 181 o más (por desfases de fechas), limitar a 180 (semestre)
        if (days > 180) days = 180;
        
        inputDias.value = days;
        
        if (days === 180) diasInfo.textContent = "Semestre completo.";
        else diasInfo.textContent = `Proporcional (${effectiveStart.toLocaleDateString()} - ${effectiveEnd.toLocaleDateString()})`;
        
        calcTotal();
    };

    const calcTotal = () => {
        const base = parseFloat(inputBase.value.replace(/[$. ]/g, '')) || 0;
        const dias = parseFloat(inputDias.value) || 0;
        const totalPrimaBruta = (base * dias) / 360;
        totalEl.textContent = currencyFormatter.format(totalPrimaBruta);

        let loanDeduction = 0;
        document.querySelectorAll('.prima-loan-deduction-input').forEach(input => {
            const val = parseFloat(input.value.replace(/[$. ]/g, '')) || 0;
            loanDeduction += val;
        });

        const totalNeto = totalPrimaBruta - loanDeduction;
        const netoEl = document.getElementById('prima-neto-pagar');
        if (netoEl) netoEl.textContent = currencyFormatter.format(totalNeto);
    };

    window.recalculatePrimaTotal = calcTotal;

    selectPeriodo.addEventListener('change', calculateDays);
    inputBase.addEventListener('input', calcTotal);
    inputDias.addEventListener('input', calcTotal);
    
    calculateDays();

    // 2. Cargar Préstamos para la Prima
    await loadActiveLoansForForm(user.id, 'prima-loan-management-placeholder', 'prima-total-loan-deduction-display', true);

    document.getElementById('prima-form').onsubmit = async (e) => {
        e.preventDefault();
        const base = parseFloat(inputBase.value.replace(/[$. ]/g, '')) || 0;
        const dias = parseFloat(inputDias.value) || 0;
        const totalPrimaBruta = (base * dias) / 360;
        const submitButton = document.getElementById('prima-submit-button');

        let loanDeduction = 0;
        const loanPayments = []; 
        document.querySelectorAll('.prima-loan-deduction-input').forEach(input => {
            const val = parseFloat(input.value.replace(/[$. ]/g, '')) || 0;
            if (val > 0) {
                loanDeduction += val;
                loanPayments.push({
                    loanId: input.dataset.loanId,
                    amount: val,
                    previousBalance: parseFloat(input.dataset.balance)
                });
            }
        });

        const totalNeto = totalPrimaBruta - loanDeduction;
        if (totalNeto < 0) {
            if(window.showToast) window.showToast("El descuento de préstamos supera el valor de la prima.", "error");
            else alert("El descuento supera el valor de la prima.");
            return;
        }

        const periodoTexto = selectPeriodo.options[selectPeriodo.selectedIndex].text;

        // Formatear fechas para guardar
        const rangoTexto = currentRange.start && currentRange.end 
            ? `${currentRange.start.toLocaleDateString('es-CO')} al ${currentRange.end.toLocaleDateString('es-CO')}` 
            : 'N/A';

        _openConfirmModal(`¿Pagar Prima (${periodoTexto}) por ${currencyFormatter.format(totalNeto)}?`, async () => {
             submitButton.disabled = true;
             try {
                 await saveSpecialPayment(user.id, {
                    tipo: 'Prima de Servicios',
                    periodo: periodoTexto,
                    monto: totalNeto,
                    detalles: { 
                        baseCalculo: base, 
                        diasSemestre: dias, 
                        semestre: selectPeriodo.value,
                        rangoFechas: rangoTexto,
                        descuentoPrestamos: loanDeduction,
                        detallesPrestamos: loanPayments
                    }
                 }, loanPayments);
             } catch(error) {
                 console.error("Error al registrar prima:", error);
             } finally {
                 submitButton.disabled = false;
             }
        });
    };
}

// --- C. FORMULARIO CESANTÍAS (CORTE ANUAL OBLIGATORIO) ---

// ==========================================
// EXTRACTED: renderCesantiasForm
// ==========================================
async function renderCesantiasForm(container, user) {
    const baseInfo = calculateBaseForBenefits(user);
    const currentYear = new Date().getFullYear();
    const realStartDate = getEmployeeStartDate(user);
    
    // --- LÓGICA DE FECHAS ANUALIZADA ---
    
    // 1. Determinar Inicio del Periodo a Liquidar (El mayor entre 1 Ene y Contrato)
    const jan1 = new Date(currentYear, 0, 1);
    // Si el contrato es viejo, arrancamos el 1 de Enero. Si es nuevo de este año, su fecha real.
    const effectiveStart = realStartDate > jan1 ? realStartDate : jan1;
    const startDateVal = effectiveStart.toISOString().split('T')[0];

    // 2. Determinar Fin del Periodo (El menor entre 31 Dic y Fin Contrato si existe)
    const dec31 = new Date(currentYear, 11, 31);
    let effectiveEnd = dec31;

    // Si el contrato ya tiene fecha fin y es este año, cortamos ahí
    if (user.contractEndDate) {
        const endDate = (typeof user.contractEndDate.toDate === 'function') 
            ? user.contractEndDate.toDate() 
            : new Date(user.contractEndDate);
            
        if (endDate < dec31) {
            effectiveEnd = endDate;
        }
    }
    const endDateVal = effectiveEnd.toISOString().split('T')[0];
    
    // -------------------------------------

    const badgeHtml = baseInfo.isMinimum 
        ? `<span class="bg-orange-100 text-orange-800 text-[10px] font-bold px-2 py-1 rounded border border-orange-200 block mt-1"><i class="fa-solid fa-triangle-exclamation mr-1"></i>Ajustado a Mínimo</span>`
        : `<span class="bg-emerald-50 text-emerald-700 text-[10px] font-bold px-2 py-1 rounded border border-emerald-200 block mt-1">${baseInfo.label}</span>`;

    container.innerHTML = `
        <form id="cesantias-form" class="space-y-6">
            <div class="bg-blue-50 border-l-4 border-blue-500 p-4 rounded-r-lg">
                <h4 class="font-bold text-blue-900">Consignación Anual de Cesantías (${currentYear})</h4>
                <p class="text-sm text-blue-700">Liquidación del año corriente para traslado al fondo.</p>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div class="col-span-1 md:col-span-2">
                    <label class="block text-xs font-bold text-gray-500 uppercase mb-2">Base Salarial</label>
                    <input type="text" id="ces-base" class="currency-input w-full border-gray-300 rounded-lg p-3 font-bold text-right text-gray-800" value="${currencyFormatter.format(baseInfo.value)}">
                    ${badgeHtml}
                </div>
                <div>
                    <label class="block text-xs font-bold text-gray-500 uppercase mb-2">Fecha Inicio (Año ${currentYear})</label>
                    <input type="date" id="ces-inicio" class="w-full border-gray-300 rounded-lg p-3 text-sm font-medium bg-gray-50" value="${startDateVal}" readonly>
                    <p class="text-[10px] text-gray-400 mt-1">Automático: 1 Ene o Ingreso.</p>
                </div>
                 <div>
                    <label class="block text-xs font-bold text-gray-500 uppercase mb-2">Fecha Corte (Año ${currentYear})</label>
                    <input type="date" id="ces-fin" class="w-full border-gray-300 rounded-lg p-3 text-sm font-medium" value="${endDateVal}">
                    <p class="text-[10px] text-gray-400 mt-1">Por defecto: 31 Dic.</p>
                </div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div class="bg-white p-4 rounded-xl border-2 border-blue-600 shadow-lg relative overflow-hidden transform transition-all hover:scale-[1.01]">
                    <div class="absolute top-0 right-0 bg-blue-600 text-white text-[10px] font-bold px-3 py-1 rounded-bl-lg uppercase tracking-wider">A Consignar</div>
                    <p class="text-xs text-gray-500 mb-1">Días Liquidados: <span id="ces-dias-calc" class="font-bold text-gray-800">0</span></p>
                    <p class="text-sm font-bold text-gray-700">Valor Cesantías</p>
                    <p id="ces-valor-fondo" class="text-3xl font-black text-blue-700 mt-1">$ 0</p>
                    <div class="mt-3 flex items-center text-[10px] text-blue-800 bg-blue-50 p-2 rounded">
                        <i class="fa-solid fa-building-columns mr-2"></i> Transferir a Fondo (Antes 14 Feb)
                    </div>
                </div>

                <div class="bg-gray-50 p-4 rounded-xl border border-gray-200 border-dashed relative">
                    <div class="absolute top-0 right-0 bg-gray-200 text-gray-600 text-[10px] font-bold px-3 py-1 rounded-bl-lg uppercase">Informativo</div>
                    <p class="text-xs text-gray-500 mb-1">Intereses (12%): <span id="ces-valor-intereses" class="font-bold text-gray-800">$ 0</span></p>
                    
                    <div class="mt-4 p-3 bg-yellow-50 border-l-4 border-yellow-400 rounded-r text-xs text-yellow-800">
                        <p class="font-bold"><i class="fa-solid fa-hand-holding-dollar mr-1"></i> ¡Atención!</p>
                        <p class="mt-1">Pagar directamente al empleado (Nómina Enero).</p>
                    </div>
                </div>
            </div>

            <button type="submit" id="btn-save-cesantias" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl shadow-md transition-all flex items-center justify-center text-lg">
                <i class="fa-solid fa-file-invoice-dollar mr-2"></i> Registrar Consignación Anual
            </button>
        </form>
    `;

    const inputBase = document.getElementById('ces-base');
    const inputInicio = document.getElementById('ces-inicio');
    const inputFin = document.getElementById('ces-fin');
    
    setupCurrencyInput(inputBase);

    const calc = () => {
        const base = parseFloat(inputBase.value.replace(/[$. ]/g, '')) || 0;
        const d1 = new Date(inputInicio.value); d1.setHours(0,0,0,0);
        const d2 = new Date(inputFin.value); d2.setHours(23,59,59,999);
        
        // Validación: No permitir fechas fuera del año actual para evitar errores contables
        if (d2.getFullYear() !== currentYear && d2.getFullYear() !== currentYear + 1) { 
             // Permitimos Enero del año siguiente como fecha de pago, pero el cálculo es del año anterior
             // Para simplificar, advertimos si la fecha corte se aleja mucho.
        }

        if (d1 && d2 && !isNaN(d1) && !isNaN(d2)) {
            // --- CAMBIO: USAR CÁLCULO 360 DÍAS ---
            // Antes: const diffTime = d2.getTime() - d1.getTime(); ...
            
            let days = calculateDays360(d1, d2);
            
            // Tope anual
            if (days > 360) days = 360;

            document.getElementById('ces-dias-calc').textContent = days;

            const valorCesantias = (base * days) / 360;
            const valorIntereses = (valorCesantias * days * 0.12) / 360;

            document.getElementById('ces-valor-fondo').textContent = currencyFormatter.format(valorCesantias);
            document.getElementById('ces-valor-intereses').textContent = currencyFormatter.format(valorIntereses);
            
            return { valorCesantias, valorIntereses, days, base };
        }
        return null;
    };

    inputBase.addEventListener('input', calc);
    inputInicio.addEventListener('change', calc);
    inputFin.addEventListener('change', calc);
    calc();

    document.getElementById('cesantias-form').onsubmit = (e) => {
        e.preventDefault();
        const data = calc();
        if(!data || data.valorCesantias <= 0) {
            window.showToast("Datos inválidos.", "error");
            return;
        }

        _openConfirmModal(`Confirmar consignación ANUAL (${currentYear}):\n\nValor Fondo: ${currencyFormatter.format(data.valorCesantias)}\nIntereses a Pagar: ${currencyFormatter.format(data.valorIntereses)}`, async () => {
             await saveSpecialPayment(user.id, {
                tipo: `Consignación Cesantías ${currentYear}`,
                periodo: `${inputInicio.value} al ${inputFin.value}`,
                monto: data.valorCesantias, 
                detalles: { 
                    base: data.base, 
                    dias: data.days, 
                    interesesCalculados: data.valorIntereses, 
                    nota: "Intereses pagados aparte al empleado",
                    anioLiquidado: currentYear
                }
            });
        });
    };
}

// --- D. FORMULARIO LIQUIDACIÓN FINAL (LÓGICA BLINDADA POR PERIODOS) ---

// ==========================================
// EXTRACTED: renderLiquidacionForm
// ==========================================
async function renderLiquidacionForm(container, user) {
    container.innerHTML = `<div class="py-12 text-center"><div class="loader mx-auto"></div><p class="text-sm text-gray-400 mt-2">Analizando cortes y periodos...</p></div>`;

    try {
        const config = getPayrollConfig() || { salarioMinimo: 1300000 }; 
        const currentYear = new Date().getFullYear();
        
        // 1. BASES
        const baseBenefits = calculateBaseForBenefits(user); 
        let vacationBase = parseFloat(user.contratacion?.salario) || parseFloat(user.salarioBasico) || 0;
        let vacationBaseLabel = "Salario Básico";
        if (user.deduccionSobreMinimo) {
            vacationBase = config.salarioMinimo;
            vacationBaseLabel = "Salario Mínimo (Config)";
        }
        
        // 2. CARGA DE DATOS (Traemos TODO el historial para buscar cortes antiguos)
        const [loansSnap, paymentsSnap] = await Promise.all([
            getDocs(query(collection(db, "users", user.id, "loans"), where("status", "==", "active"))),
            getDocs(query(collection(db, "users", user.id, "paymentHistory"), orderBy("createdAt", "desc")))
        ]);

        let totalLoans = 0;
        loansSnap.forEach(doc => totalLoans += (doc.data().balance || 0));

        // 3. ANÁLISIS DE PERIODOS (AQUÍ ESTÁ LA LÓGICA DE SEPARACIÓN DE AÑOS)
        let primaPagadaSemestre = 0;
        let lastCesantiasYear = 0; 
        let anticiposCesantias = 0; 
        let diasVacacionesTomados = 0; 

        const payments = paymentsSnap.docs.map(d => d.data());

        // A. Buscar el último año que se cerró (Consignación a Fondo)
        payments.forEach(p => {
            const concepto = (p.concepto || '').toLowerCase();
            const det = p.details || {};
            if (concepto.includes('fondo') && (concepto.includes('cesant'))) {
                let year = det.anioLiquidado ? parseInt(det.anioLiquidado) : (p.createdAt ? p.createdAt.toDate().getFullYear() - 1 : 0);
                if (year > lastCesantiasYear) lastCesantiasYear = year;
            }
        });

        // B. Definir Fecha Inicio Cesantías (El corte limpio)
        const realStartDate = getEmployeeStartDate(user);
        let cesantiasStartDate = new Date(realStartDate); 

        // Si ya pagamos 2023, arrancamos LIMPIOS el 1 Ene 2024
        if (lastCesantiasYear > 0) {
            const potentialStart = new Date(lastCesantiasYear + 1, 0, 1);
            if (potentialStart > cesantiasStartDate) cesantiasStartDate = potentialStart;
        }
        // Normalizar hora para comparaciones exactas
        cesantiasStartDate.setHours(0,0,0,0);

        // C. Definir Inicio del Semestre Actual (Para la Prima)
        const startOfCurrentSemester = new Date(currentYear, new Date().getMonth() > 5 ? 6 : 0, 1);
        startOfCurrentSemester.setHours(0,0,0,0);

        // D. Filtrar pagos (SOLO RESTAR LO QUE PERTENECE AL PERIODO ACTUAL)
        payments.forEach(p => {
            const pDate = p.createdAt ? p.createdAt.toDate() : new Date(p.paymentDate);
            pDate.setHours(0,0,0,0);
            
            const concepto = (p.concepto || '').toLowerCase();
            const det = p.details || {};

            // --- FILTRO DE PRIMA ---
            // Solo restamos pagos hechos DESPUÉS del inicio del semestre. 
            // Si pagaste una prima en Enero y estamos en Julio, NO se resta.
            if (concepto.includes('prima') && pDate >= startOfCurrentSemester) {
                primaPagadaSemestre += (p.monto || 0);
            }

            // --- FILTRO DE CESANTÍAS ---
            // Solo restamos anticipos hechos DESPUÉS del último corte anual.
            // Si diste un anticipo en 2023 y ya cerraste el año, ese anticipo NO cuenta aquí.
            if (concepto.includes('cesant') && !concepto.includes('interes') && !concepto.includes('fondo')) {
                if (pDate >= cesantiasStartDate) {
                    anticiposCesantias += (p.monto || 0);
                }
            }

            // Vacaciones (Acumulado histórico total)
            if (concepto.includes('vacaciones')) {
                if (det.diasPagados) diasVacacionesTomados += parseFloat(det.diasPagados);
                else if (det.dias) diasVacacionesTomados += parseFloat(det.dias);
            }
        });

        // 4. FECHAS UI
        const todayStr = new Date().toISOString().split('T')[0];
        let agreedEndDate = null;
        if (user.contractEndDate) {
            agreedEndDate = (typeof user.contractEndDate.toDate === 'function') 
                ? user.contractEndDate.toDate() : new Date(user.contractEndDate);
        }
        const contractEndStr = agreedEndDate ? agreedEndDate.toISOString().split('T')[0] : '';
        const defaultContractType = user.contractType || (agreedEndDate ? 'fijo' : 'indefinido');

        // --- RENDERIZADO ---
        container.innerHTML = `
            <form id="liq-form" class="space-y-6">
                <div class="bg-red-50 border-l-4 border-red-500 p-4 rounded-r-lg flex justify-between items-center">
                    <div>
                        <h4 class="font-bold text-red-900">Liquidación Final</h4>
                        <p class="text-sm text-red-700">Calculando saldo pendiente a la fecha.</p>
                    </div>
                    <div class="text-right text-xs">
                        <p class="text-red-400 font-bold uppercase">Ingreso</p>
                        <p class="font-mono font-bold text-red-800">${realStartDate.toLocaleDateString('es-CO')}</p>
                    </div>
                </div>
                
                <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                     <div>
                        <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Motivo Retiro</label>
                        <select id="liq-motivo" class="w-full border-gray-300 rounded-lg p-2 text-sm bg-white">
                            <option value="voluntario">Renuncia Voluntaria</option>
                            <option value="terminacion">Terminación de Contrato</option>
                            <option value="justa_causa">Despido Justa Causa</option>
                            <option value="sin_justa_causa">Despido Sin Justa Causa</option>
                        </select>
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Tipo Contrato</label>
                        <select id="liq-tipo-contrato" class="w-full border-gray-300 rounded-lg p-2 text-sm bg-white">
                            <option value="indefinido" ${defaultContractType === 'indefinido' ? 'selected' : ''}>Indefinido</option>
                            <option value="fijo" ${defaultContractType === 'fijo' ? 'selected' : ''}>Término Fijo</option>
                        </select>
                    </div>
                     <div>
                        <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Fecha Retiro</label>
                        <input type="date" id="liq-fecha-fin" class="w-full border-gray-300 rounded-lg p-2 text-sm font-bold text-gray-700 focus:ring-red-500" value="${todayStr}">
                    </div>
                </div>
                
                <div id="div-fecha-pactada" class="hidden">
                    <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Fecha Fin Pactada</label>
                    <input type="date" id="liq-fecha-pactada" class="w-full border-gray-300 rounded-lg p-2 text-sm bg-gray-50" value="${contractEndStr}">
                </div>

                <div class="space-y-4 border-t border-gray-200 pt-4">
                    <h5 class="font-bold text-gray-700 text-sm">Detalle de Valores</h5>
                    
                    <div class="grid grid-cols-2 gap-2 mb-2">
                        <div class="bg-indigo-50 p-2 rounded border border-indigo-100">
                            <p class="text-[10px] text-indigo-400 uppercase font-bold">Corte Cesantías</p>
                            <p class="text-xs font-bold text-indigo-800" id="lbl-inicio-cesantias">${cesantiasStartDate.toLocaleDateString('es-CO')}</p>
                            <p class="text-[9px] text-indigo-400 italic">Fecha base del cálculo</p>
                        </div>
                        <div class="bg-blue-50 p-2 rounded border border-blue-100">
                             <p class="text-[10px] text-blue-400 uppercase font-bold">Base Prestacional</p>
                             <p class="text-xs font-bold text-blue-800">${currencyFormatter.format(baseBenefits.value)}</p>
                        </div>
                    </div>

                    <div class="grid grid-cols-12 gap-2 items-center bg-gray-50 p-2 rounded-lg border border-gray-200">
                        <div class="col-span-5">
                            <p class="text-xs font-bold text-gray-600">Cesantías</p>
                            <p class="text-[10px] text-gray-400">Días: <span id="lbl-dias-cesantias">0</span> | Menos: ${currencyFormatter.format(anticiposCesantias)}</p>
                        </div>
                        <div class="col-span-7">
                            <input type="text" id="liq-cesantias" class="currency-input w-full border-gray-200 rounded p-1 text-right text-sm font-bold bg-white" placeholder="$ 0">
                        </div>
                    </div>

                    <div class="grid grid-cols-12 gap-2 items-center bg-gray-50 p-2 rounded-lg">
                        <div class="col-span-5">
                            <p class="text-xs font-bold text-gray-600">Intereses Cesantías</p>
                            <p class="text-[10px] text-gray-400">12% sobre saldo Cesantías</p>
                        </div>
                        <div class="col-span-7">
                            <input type="text" id="liq-intereses" class="currency-input w-full border-gray-200 rounded p-1 text-right text-sm font-bold bg-white" placeholder="$ 0">
                        </div>
                    </div>

                    <div class="grid grid-cols-12 gap-2 items-center bg-gray-50 p-2 rounded-lg border border-gray-200">
                        <div class="col-span-5">
                            <p class="text-xs font-bold text-gray-600">Prima Servicios</p>
                            <p class="text-[10px] text-gray-400">Semestre Actual | Menos: ${currencyFormatter.format(primaPagadaSemestre)}</p>
                        </div>
                        <div class="col-span-7">
                            <input type="text" id="liq-prima" class="currency-input w-full border-gray-200 rounded p-1 text-right text-sm font-bold bg-white" placeholder="$ 0">
                        </div>
                    </div>

                    <div class="grid grid-cols-12 gap-2 items-center bg-blue-50/50 p-2 rounded-lg border border-blue-100">
                        <div class="col-span-5">
                            <p class="text-xs font-bold text-gray-600">Vacaciones</p>
                            <p class="text-[10px] text-gray-400">Total: <span id="lbl-total-vac">0</span> - Tomados: <span class="text-red-500 font-bold">${diasVacacionesTomados.toFixed(1)}</span></p>
                        </div>
                        <div class="col-span-7">
                            <input type="text" id="liq-vacaciones" class="currency-input w-full border-blue-200 rounded p-1 text-right text-sm font-bold text-blue-800 bg-white" placeholder="$ 0">
                        </div>
                    </div>
                    
                    <div class="grid grid-cols-12 gap-2 items-center bg-yellow-50 p-2 rounded-lg border border-yellow-200 transition-colors" id="row-indemnizacion">
                        <div class="col-span-5">
                            <p class="text-xs font-bold text-yellow-800">Indemnización</p>
                            <p class="text-[10px] text-yellow-600" id="lbl-indemnizacion-info">Sin Justa Causa</p>
                        </div>
                        <div class="col-span-7">
                            <input type="text" id="liq-indemnizacion" class="currency-input w-full border-yellow-300 rounded p-1 text-right text-sm font-bold text-yellow-800" placeholder="$ 0">
                        </div>
                    </div>

                     <div class="grid grid-cols-12 gap-2 items-center bg-red-50 p-2 rounded-lg border border-red-100">
                        <div class="col-span-5">
                            <p class="text-xs font-bold text-red-600">Total Deducciones</p>
                            <p class="text-[10px] text-red-400">Préstamos pendientes</p>
                        </div>
                        <div class="col-span-7">
                            <input type="text" id="liq-deducciones" class="currency-input w-full border-red-200 rounded p-1 text-right text-sm font-bold text-red-600 bg-white" value="${currencyFormatter.format(totalLoans)}">
                        </div>
                    </div>
                </div>

                 <div class="bg-gray-800 text-white p-5 rounded-xl flex justify-between items-center shadow-lg">
                    <div>
                        <span class="block text-[10px] text-gray-400 uppercase tracking-widest">Total a Pagar</span>
                        <span class="text-xs text-gray-500">Liquidación Neta</span>
                    </div>
                    <span id="liq-total" class="font-black text-3xl tracking-tight">$ 0</span>
                </div>

                <button type="submit" class="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-3 rounded-xl shadow-md transition-all flex items-center justify-center gap-2">
                    <i class="fa-solid fa-gavel mr-2"></i> Finalizar Contrato y Archivar
                </button>
            </form>
        `;

        const inputs = {
            motivo: document.getElementById('liq-motivo'),
            tipoContrato: document.getElementById('liq-tipo-contrato'),
            fecha: document.getElementById('liq-fecha-fin'),
            fechaPactada: document.getElementById('liq-fecha-pactada'),
            divFechaPactada: document.getElementById('div-fecha-pactada'),
            cesantias: document.getElementById('liq-cesantias'),
            intereses: document.getElementById('liq-intereses'),
            prima: document.getElementById('liq-prima'),
            vacaciones: document.getElementById('liq-vacaciones'),
            indem: document.getElementById('liq-indemnizacion'),
            deducciones: document.getElementById('liq-deducciones'),
            total: document.getElementById('liq-total')
        };
        
        container.querySelectorAll('.currency-input').forEach(i => {
            setupCurrencyInput(i);
            i.addEventListener('input', updateLiqTotal);
        });

        let liquidacionData = { diasCesantias: 0 };

        function calculateValues() {
            const endDate = new Date(inputs.fecha.value);
            endDate.setHours(23, 59, 59, 999);
            if (isNaN(endDate.getTime())) return;

            // 1. DÍAS CESANTÍAS (Desde el corte detectado)
            const startC = new Date(cesantiasStartDate); startC.setHours(0,0,0,0);
            const endC = new Date(endDate); endC.setHours(0,0,0,0);
            
            // --- CAMBIO: USAR 360 ---
            let diasCesantias = calculateDays360(startC, endC);
            
            document.getElementById('lbl-dias-cesantias').textContent = diasCesantias;
            liquidacionData.diasCesantias = diasCesantias;

            // VALOR CESANTÍAS (NETO: Generado - Anticipos del periodo)
            const valCesantiasTotal = (baseBenefits.value * diasCesantias) / 360;
            const valCesantiasNeto = Math.max(0, valCesantiasTotal - anticiposCesantias);
            inputs.cesantias.value = currencyFormatter.format(valCesantiasNeto);

            // INTERESES (Sobre el NETO que se debe hoy, asumiendo que anticipos pagaron intereses)
            const valIntereses = (valCesantiasNeto * diasCesantias * 0.12) / 360;
            inputs.intereses.value = currencyFormatter.format(valIntereses);


            // 2. PRIMA (Semestral)
            const startSemestre = new Date(currentYear, new Date().getMonth() > 5 ? 6 : 0, 1);
            // Si el contrato empezó en medio del semestre, se usa la fecha contrato
            const effectiveStartPrima = realStartDate > startSemestre ? realStartDate : startSemestre;
            
            const diffPrima = Math.abs(endC - effectiveStartPrima);

            let diasPrima = calculateDays360(effectiveStartPrima, endC);
            if (diasPrima > 180) diasPrima = 180; // Tope semestral

            const valPrimaTotal = (baseBenefits.value * diasPrima) / 360;
            const valPrimaNeto = Math.max(0, valPrimaTotal - primaPagadaSemestre);
            inputs.prima.value = currencyFormatter.format(valPrimaNeto);

            // 3. VACACIONES (Históricas)
            const startHistory = new Date(realStartDate); startHistory.setHours(0,0,0,0);
            
            // --- CAMBIO: USAR 360 PARA VACACIONES TAMBIÉN ---
            // Nota: Aunque vacaciones suelen ser calendario, para provisión contable se suele usar 360.
            // Si prefieres calendario estricto para vacaciones, deja la fórmula anterior.
            // Para consistencia con nómina:
            const totalDaysWorked = calculateDays360(startHistory, endC);

            const totalVacacionesGeneradas = (totalDaysWorked * 15) / 360;

            const diasVacPendientes = Math.max(0, totalVacacionesGeneradas - diasVacacionesTomados);
            
            document.getElementById('lbl-total-vac').textContent = totalVacacionesGeneradas.toFixed(1);
            inputs.vacaciones.value = currencyFormatter.format((vacationBase / 30) * diasVacPendientes);


            // 4. INDEMNIZACIÓN
            const motivo = inputs.motivo.value;
            const tipo = inputs.tipoContrato.value;
            if (tipo === 'fijo') inputs.divFechaPactada.classList.remove('hidden');
            else inputs.divFechaPactada.classList.add('hidden');

            if (motivo === 'sin_justa_causa') {
                const indemnizacion = calculateIndemnificationValue(
                    tipo, realStartDate, endDate,       
                    inputs.fechaPactada.value ? new Date(inputs.fechaPactada.value) : null,
                    parseFloat(user.contratacion?.salario) || parseFloat(user.salarioBasico) || 0 
                );
                inputs.indem.value = currencyFormatter.format(indemnizacion);
                document.getElementById('row-indemnizacion').classList.add('bg-yellow-100', 'border-yellow-400');
                document.getElementById('lbl-indemnizacion-info').textContent = "Calculada Automáticamente";
            } else {
                inputs.indem.value = "$ 0";
                document.getElementById('row-indemnizacion').classList.remove('bg-yellow-100', 'border-yellow-400');
                document.getElementById('lbl-indemnizacion-info').textContent = "No aplica";
            }
            updateLiqTotal();
        }

        function updateLiqTotal() {
            let total = 0;
            ['liq-cesantias', 'liq-intereses', 'liq-prima', 'liq-vacaciones', 'liq-indemnizacion'].forEach(id => {
                total += parseFloat(document.getElementById(id).value.replace(/[$. ]/g, '')) || 0;
            });
            const deductions = parseFloat(inputs.deducciones.value.replace(/[$. ]/g, '')) || 0;
            inputs.total.textContent = currencyFormatter.format(total - deductions);
        }

        inputs.fecha.addEventListener('change', calculateValues);
        inputs.motivo.addEventListener('change', calculateValues);
        inputs.tipoContrato.addEventListener('change', calculateValues);
        inputs.fechaPactada.addEventListener('change', calculateValues);
        calculateValues();

        document.getElementById('liq-form').onsubmit = (e) => {
            e.preventDefault();
            const totalText = inputs.total.textContent;
            const monto = parseFloat(totalText.replace(/[$. \u00A0]/g, '').replace(',', '.')) || 0;
            
            const fechaRetiroInput = inputs.fecha.value;
            let fechaRetiroFmt = fechaRetiroInput;
            if (fechaRetiroInput) {
                const parts = fechaRetiroInput.split('-'); 
                if (parts.length === 3) fechaRetiroFmt = `${parts[2]}/${parts[1]}/${parts[0]}`;
            }

            _openConfirmModal(`CONFIRMAR LIQUIDACIÓN:\n\nTotal: ${totalText}\n\nEl usuario será ARCHIVADO.`, async () => {
                 await saveSpecialPayment(user.id, {
                    tipo: 'Liquidación Final de Contrato',
                    monto: monto,
                    detalles: { 
                        motivo: inputs.motivo.value,
                        fechaIngreso: realStartDate.toLocaleDateString('es-CO'), 
                        fechaRetiro: fechaRetiroFmt,
                        
                        diasLiquidados: liquidacionData.diasCesantias, 
                        
                        cesantias: inputs.cesantias.value,
                        cesantiasDescontadas: anticiposCesantias,
                        intereses: inputs.intereses.value,
                        prima: inputs.prima.value,
                        primaDescontada: primaPagadaSemestre,
                        vacaciones: inputs.vacaciones.value,
                        vacacionesTomadas: diasVacacionesTomados,
                        indemnizacion: inputs.indem.value,
                        deducciones: inputs.deducciones.value,
                        
                        basePrestacional: baseBenefits.value,
                        baseSalarial: vacationBase 
                    }
                });
                
                if (totalLoans > 0) {
                   const batch = writeBatch(db);
                   loansSnap.forEach(doc => batch.update(doc.ref, { status: 'paid', paidAt: serverTimestamp(), note: 'Cancelado Liquidación' }));
                   await batch.commit();
                }

                await updateDoc(doc(db, "users", user.id), { 
                    status: 'archived', 
                    contractEndDate: new Date(inputs.fecha.value)
                });
                
                window.showToast("Liquidación registrada.", "success");
                loadEmpleadosView(); 
            });
        };

    } catch (error) {
        console.error("Error liquidación:", error);
    }
}

// --- E. FORMULARIO VACACIONES (NUEVO MÓDULO) ---

// ==========================================
// EXTRACTED: renderVacacionesForm
// ==========================================
async function renderVacacionesForm(container, user) {
    container.innerHTML = `<div class="py-12 text-center"><div class="loader mx-auto"></div><p class="text-sm text-gray-400 mt-2">Calculando días disponibles...</p></div>`;

    try {
        const config = getPayrollConfig() || { salarioMinimo: 1300000 };
        
        // 1. BASE: Vacaciones siempre es sobre el básico (sin auxilio), salvo que sea salario mínimo.
        let vacationBase = parseFloat(user.contratacion?.salario) || parseFloat(user.salarioBasico) || 0;
        let vacationBaseLabel = "Salario Básico";
        if (user.deduccionSobreMinimo) {
            vacationBase = config.salarioMinimo;
            vacationBaseLabel = "Salario Mínimo (Config)";
        }

        // 2. FECHAS
        const realStartDate = getEmployeeStartDate(user);
        const today = new Date();
        const diffTime = Math.abs(today - realStartDate);
        const daysWorkedTotal = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); // Días totales contrato

        // 3. HISTORIAL: Buscar días ya pagados/disfrutados
        // Buscamos en TOOOODO el historial de pagos
        const q = query(collection(db, "users", user.id, "paymentHistory"));
        const snapshot = await getDocs(q);
        
        let diasTomados = 0;
        snapshot.forEach(doc => {
            const p = doc.data();
            const concepto = (p.concepto || '').toLowerCase();
            const det = p.details || {};

            // Sumamos si es un pago específico de vacaciones o si fue una liquidación final previa
            if (concepto.includes('vacaciones')) {
                // Si guardamos "diasPagados" en details, lo usamos. Si no, inferimos por monto (menos preciso)
                if (det.diasPagados) {
                    diasTomados += parseFloat(det.diasPagados);
                } else if (det.dias) {
                    diasTomados += parseFloat(det.dias); // Compatibilidad
                }
            }
            // También revisar si hubo una liquidación final anterior que pagó vacaciones
            if (concepto.includes('liquidaci') && det.vacaciones && det.diasLiquidados) {
                 // Nota: Esto es complejo si se re-contrató. 
                 // Asumimos que si hay una liquidación, el contrato se reinició y la fecha de inicio cambió.
                 // Si la fecha de inicio es la misma, sumamos esos días.
            }
        });

        // 4. CÁLCULO DE DÍAS
        // Fórmula: 15 días por cada 360 días trabajados
        const diasGenerados = (daysWorkedTotal * 15) / 360;
        const diasPendientes = Math.max(0, diasGenerados - diasTomados);
        
        // Valor monetario de los días pendientes
        const valorPendiente = (vacationBase / 30) * diasPendientes;


        // --- HTML UI ---
        container.innerHTML = `
            <form id="vacaciones-form" class="space-y-6">
                <div class="bg-cyan-50 border-l-4 border-cyan-500 p-4 rounded-r-lg flex justify-between items-center">
                    <div>
                        <h4 class="font-bold text-cyan-900">Gestión de Vacaciones</h4>
                        <p class="text-sm text-cyan-700">Disfrute o compensación en dinero.</p>
                    </div>
                     <div class="text-right text-xs hidden sm:block">
                        <p class="text-cyan-500 font-bold uppercase">Base Cálculo</p>
                        <p class="font-mono font-bold text-cyan-800">${currencyFormatter.format(vacationBase)}</p>
                    </div>
                </div>

                <div class="grid grid-cols-3 gap-4 text-center">
                    <div class="bg-white p-3 rounded-lg border border-gray-200 shadow-sm">
                        <p class="text-[10px] text-gray-400 uppercase font-bold">Generados</p>
                        <p class="text-lg font-bold text-gray-700" title="Total contrato">${diasGenerados.toFixed(1)} <span class="text-xs font-normal">días</span></p>
                    </div>
                    <div class="bg-white p-3 rounded-lg border border-gray-200 shadow-sm">
                        <p class="text-[10px] text-gray-400 uppercase font-bold">Tomados</p>
                        <p class="text-lg font-bold text-orange-500">${diasTomados.toFixed(1)} <span class="text-xs font-normal">días</span></p>
                    </div>
                    <div class="bg-cyan-50 p-3 rounded-lg border border-cyan-200 shadow-sm">
                        <p class="text-[10px] text-cyan-600 uppercase font-bold">Disponibles</p>
                        <p class="text-xl font-black text-cyan-700" id="vac-saldo-dias">${diasPendientes.toFixed(1)}</p>
                    </div>
                </div>

                <div class="border-t border-gray-100 pt-4">
                    <h5 class="font-bold text-gray-700 text-sm mb-4">Registrar Novedad</h5>
                    
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <label class="block text-xs font-bold text-gray-500 uppercase mb-2">Días a Pagar / Disfrutar</label>
                            <div class="flex items-center gap-2">
                                <input type="number" id="vac-dias-pagar" class="w-full border-gray-300 rounded-lg p-3 text-center font-bold text-gray-700 focus:ring-cyan-500" placeholder="0" min="0.5" step="0.5">
                                <button type="button" id="btn-max-vac" class="bg-gray-100 hover:bg-gray-200 text-gray-600 text-xs font-bold px-3 py-3 rounded-lg border border-gray-200">MAX</button>
                            </div>
                        </div>
                        
                        <div>
                            <label class="block text-xs font-bold text-gray-500 uppercase mb-2">Valor a Pagar</label>
                            <input type="text" id="vac-valor" class="currency-input w-full border-gray-300 rounded-lg p-3 font-bold text-right text-cyan-700 focus:ring-cyan-500" value="$ 0">
                        </div>
                    </div>
                    
                    <div class="mt-4">
                        <label class="block text-xs font-bold text-gray-500 uppercase mb-2">Periodo / Nota</label>
                        <input type="text" id="vac-nota" class="w-full border-gray-300 rounded-lg p-3 text-sm" placeholder="Ej: Vacaciones adelantadas, Semana Santa, etc.">
                    </div>
                    
                     <div class="mt-4 flex gap-4">
                        <label class="flex items-center gap-2 cursor-pointer bg-gray-50 p-2 rounded border border-gray-100 flex-1">
                            <input type="radio" name="tipo_vac" value="disfrute" checked class="text-cyan-600 focus:ring-cyan-500">
                            <div class="text-sm">
                                <span class="block font-bold text-gray-700">Disfrute (Tiempo)</span>
                                <span class="block text-[10px] text-gray-400">El empleado sale a descansar.</span>
                            </div>
                        </label>
                         <label class="flex items-center gap-2 cursor-pointer bg-gray-50 p-2 rounded border border-gray-100 flex-1">
                            <input type="radio" name="tipo_vac" value="dinero" class="text-cyan-600 focus:ring-cyan-500">
                             <div class="text-sm">
                                <span class="block font-bold text-gray-700">Compensadas (Dinero)</span>
                                <span class="block text-[10px] text-gray-400">Se pagan sin dejar de trabajar.</span>
                            </div>
                        </label>
                    </div>
                </div>

                <div class="bg-gray-800 text-white p-5 rounded-xl flex justify-between items-center shadow-lg">
                    <div>
                        <span class="block text-[10px] text-gray-400 uppercase tracking-widest">Total a Girar</span>
                        <span class="text-xs text-gray-500">Neto Vacaciones</span>
                    </div>
                    <span id="vac-total" class="font-black text-3xl tracking-tight">$ 0</span>
                </div>

                <button type="submit" class="w-full bg-cyan-600 hover:bg-cyan-700 text-white font-bold py-3 rounded-xl shadow-md transition-all flex items-center justify-center gap-2">
                    <i class="fa-solid fa-umbrella-beach"></i> Registrar Vacaciones
                </button>
            </form>
        `;
        
        // Listeners
        const inputDias = document.getElementById('vac-dias-pagar');
        const inputValor = document.getElementById('vac-valor');
        const inputNota = document.getElementById('vac-nota');
        const displayTotal = document.getElementById('vac-total');
        
        setupCurrencyInput(inputValor);

        // Auto-calcular valor al cambiar días
        inputDias.addEventListener('input', () => {
            const dias = parseFloat(inputDias.value) || 0;
            const valor = (vacationBase / 30) * dias;
            inputValor.value = currencyFormatter.format(valor);
            displayTotal.textContent = currencyFormatter.format(valor);
        });

        // Permitir editar valor manual y actualizar total
        inputValor.addEventListener('input', () => {
             displayTotal.textContent = inputValor.value;
        });

        // Botón MAX
        document.getElementById('btn-max-vac').onclick = () => {
            inputDias.value = diasPendientes.toFixed(1);
            inputDias.dispatchEvent(new Event('input')); // Disparar recalculo
        };

        // Guardar
        document.getElementById('vacaciones-form').onsubmit = (e) => {
            e.preventDefault();
            const diasAPagar = parseFloat(inputDias.value) || 0;
            const valorTotal = parseFloat(inputValor.value.replace(/[$. ]/g, '')) || 0;
            const tipo = document.querySelector('input[name="tipo_vac"]:checked').value;
            const nota = inputNota.value || (tipo === 'disfrute' ? 'Vacaciones disfrutadas' : 'Vacaciones compensadas en dinero');

            if (diasAPagar <= 0) { window.showToast("Ingresa días válidos.", "error"); return; }

            const tituloConcepto = tipo === 'disfrute' ? 'Pago de Vacaciones (Disfrute)' : 'Vacaciones Compensadas (Dinero)';

            _openConfirmModal(`¿Registrar pago de ${diasAPagar} días de vacaciones por ${currencyFormatter.format(valorTotal)}?`, async () => {
                await saveSpecialPayment(user.id, {
                    tipo: tituloConcepto,
                    monto: valorTotal,
                    detalles: {
                        diasPagados: diasAPagar, // CLAVE: Este dato se leerá en la liquidación para descontar
                        baseCalculo: vacationBase,
                        tipoVacaciones: tipo,
                        periodoNota: nota,
                        saldoAnteriorDias: diasPendientes
                    }
                });
            });
        };

    } catch (e) {
        console.error(e);
        container.innerHTML = `<p class="text-red-500 text-center">Error cargando vacaciones.</p>`;
    }
}

/**
 * Calcula la indemnización por despido sin justa causa (Norma Colombia).
 * @param {string} type - 'fijo' o 'indefinido'
 * @param {Date} startDate - Fecha inicio contrato
 * @param {Date} endDate - Fecha de despido
 * @param {Date} contractEndDate - Fecha fin pactada (Solo para fijo)
 * @param {number} salary - Salario base
 */

// ==========================================
// EXTRACTED: saveSpecialPayment
// ==========================================
async function saveSpecialPayment(userId, data, loanPayments = []) {
    const paymentData = {
        userId: userId,
        paymentDate: new Date().toISOString().split('T')[0],
        concepto: data.tipo,
        monto: data.monto,
        details: data.detalles || {},
        createdAt: serverTimestamp(),
        registeredBy: currentUser.uid(),
        isSpecial: true // Flag para diferenciar en reportes
    };

    const batch = writeBatch(db);
    const paymentHistoryRef = doc(collection(db, "users", userId, "paymentHistory"));
    batch.set(paymentHistoryRef, paymentData);

    // Amortizar préstamos si existen en la transacción
    loanPayments.forEach(pago => {
        const loanRef = doc(db, "users", userId, "loans", pago.loanId);
        const newBalance = pago.previousBalance - pago.amount;
        const updateData = { balance: newBalance };
        if (newBalance <= 0) { 
            updateData.status = 'paid'; 
            updateData.paidAt = serverTimestamp(); 
        }
        batch.update(loanRef, updateData);
    });

    await batch.commit();
    window.showToast("Pago registrado correctamente.", "success");
    loadPaymentHistoryView(userId); // Recargar
}

/**
 * Carga los préstamos activos dentro del formulario de nómina para aplicar deducciones.
 * Se llama automáticamente al renderizar la pestaña "Nómina".
 */

// ==========================================
// EXTRACTED: loadActiveLoansForForm
// ==========================================
async function loadActiveLoansForForm(userId, placeholderId = 'loan-management-fieldset-placeholder', displayId = 'payment-total-loan-deduction-display', isPrima = false) {
    const fieldset = document.getElementById(placeholderId);
    if (!fieldset) return;

    // 1. Mostrar estado de carga
    fieldset.innerHTML = `
        <div class="flex justify-center items-center py-4 bg-gray-50 rounded-lg border border-dashed border-gray-300">
            <div class="loader-small mx-auto"></div>
            <span class="ml-2 text-xs text-gray-400">Buscando préstamos activos...</span>
        </div>`;

    try {
        // 2. Consulta a Firebase (Solo préstamos con status "active")
        const q = query(
            collection(db, "users", userId, "loans"),
            where("status", "==", "active"),
            orderBy("date", "asc")
        );
        
        const snapshot = await getDocs(q);

        // 3. Si no hay préstamos, limpiar y salir
        if (snapshot.empty) {
            fieldset.innerHTML = `
                <div class="text-center py-3 bg-green-50 rounded-lg border border-green-100">
                    <p class="text-xs text-green-700 font-bold"><i class="fa-solid fa-check mr-1"></i> Paz y Salvo</p>
                    <p class="text-[10px] text-green-600">Este usuario no tiene deudas activas.</p>
                </div>`;
            return;
        }

        // 4. Generar HTML de la lista
        let html = `
            <h4 class="text-xs font-black text-rose-600 uppercase tracking-widest mb-4 border-b border-rose-100 pb-1 w-fit">Descontar Préstamos</h4>
            <div class="space-y-2">`;
        let totalDebt = 0;

        snapshot.forEach(doc => {
            const loan = doc.data();
            const loanId = doc.id;
            
            totalDebt += (loan.balance || 0);

            // Calcular Cuota Sugerida
            let installmentVal = (loan.amount / (loan.installments || 1));
            if (installmentVal > loan.balance) {
                installmentVal = loan.balance;
            }

            const initialVal = isPrima ? 0 : installmentVal;
            const inputClass = isPrima ? 'prima-loan-deduction-input' : 'loan-deduction-input';

            html += `
                <div class="flex justify-between items-center bg-white p-2 rounded-lg border border-gray-200 shadow-sm hover:border-indigo-300 transition-colors">
                    <div class="flex-1 min-w-0 pr-3">
                        <div class="flex justify-between items-start">
                            <p class="text-xs font-bold text-gray-700 truncate" title="${loan.description}">
                                ${loan.description}
                            </p>
                            <span class="text-[9px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded border border-gray-200">
                                ${new Date(loan.date).toLocaleDateString('es-CO', {month:'short', day:'numeric'})}
                            </span>
                        </div>
                        <div class="flex justify-between items-center mt-1">
                            <p class="text-[10px] text-gray-400">
                                Cuotas: ${loan.installments}
                            </p>
                            <p class="text-[10px] font-medium text-gray-500">
                                Saldo: <span class="text-rose-600 font-bold">${currencyFormatter.format(loan.balance)}</span>
                            </p>
                        </div>
                    </div>

                    <div class="w-28">
                        <label class="block text-[9px] text-indigo-400 font-bold uppercase text-right mb-0.5">A Descontar</label>
                        <input type="text" 
                            class="${inputClass} w-full border border-gray-300 rounded-md py-1 px-2 text-right text-xs font-bold text-gray-800 focus:ring-2 focus:ring-rose-500 focus:border-rose-500 outline-none transition-all"
                            value="${currencyFormatter.format(initialVal)}"
                            data-loan-id="${loanId}"
                            data-balance="${loan.balance}">
                    </div>
                </div>
            `;
        });

        html += `</div>`;
        
        // Agregar footer con totales
        html += `
            <div class="mt-3 flex justify-between items-center pt-2 border-t border-red-100">
                <span class="text-[10px] text-gray-500">Deuda Total: <strong>${currencyFormatter.format(totalDebt)}</strong></span>
                <div class="text-right">
                    <span class="text-[10px] font-bold text-rose-500 uppercase mr-1">Total Descuento:</span>
                    <span id="${displayId}" class="text-sm font-black text-rose-700">$ 0</span>
                </div>
            </div>
        `;

        fieldset.innerHTML = html;

        // 5. Configurar Listeners e Inputs
        const inputClass = isPrima ? 'prima-loan-deduction-input' : 'loan-deduction-input';
        const inputs = fieldset.querySelectorAll(`.${inputClass}`);
        inputs.forEach(input => {
            if (setupCurrencyInput) setupCurrencyInput(input);
            
            input.addEventListener('input', () => {
                let loanDeduction = 0;
                fieldset.querySelectorAll(`.${inputClass}`).forEach(inp => {
                    const val = parseFloat(inp.value.replace(/[$. ]/g, '')) || 0;
                    loanDeduction += val;
                });
                const display = document.getElementById(displayId);
                if (display) display.textContent = currencyFormatter.format(loanDeduction);
                
                if (isPrima) {
                    if (typeof window.recalculatePrimaTotal === 'function') {
                        window.recalculatePrimaTotal();
                    }
                } else {
                    if (typeof updatePaymentTotal === 'function') {
                        updatePaymentTotal();
                    }
                }
            });
        });

        // 6. Ejecutar cálculo inicial
        let initialDeduction = 0;
        fieldset.querySelectorAll(`.${inputClass}`).forEach(inp => {
            const val = parseFloat(inp.value.replace(/[$. ]/g, '')) || 0;
            initialDeduction += val;
        });
        const disp = document.getElementById(displayId);
        if (disp) disp.textContent = currencyFormatter.format(initialDeduction);

        if (isPrima) {
            if (typeof window.recalculatePrimaTotal === 'function') {
                window.recalculatePrimaTotal();
            }
        } else {
            if (typeof updatePaymentTotal === 'function') {
                updatePaymentTotal();
            }
        }

    } catch (error) {
        console.error("Error cargando préstamos para formulario:", error);
        fieldset.innerHTML = `<p class="text-center text-xs text-red-500 py-2">Error al cargar datos de préstamos.</p>`;
    }
}


// --- LISTADO DE HISTORIAL (CORREGIDO PARA ABRIR COMPROBANTE) ---

// ==========================================
// EXTRACTED: loadPaymentHistoryList
// ==========================================
function loadPaymentHistoryList(userId, tableBody, user) {
    const q = query(collection(db, "users", userId, "paymentHistory"), orderBy("createdAt", "desc"));
    
    let paymentsList = [];
    let currentPage = 1;
    const itemsPerPage = 5;

    const renderPage = (page) => {
        tableBody.innerHTML = '';
        const startIndex = (page - 1) * itemsPerPage;
        const endIndex = Math.min(startIndex + itemsPerPage, paymentsList.length);
        const pageItems = paymentsList.slice(startIndex, endIndex);

        if (pageItems.length === 0) {
            tableBody.innerHTML = `<tr><td class="p-8 text-center text-sm text-gray-400 border-b border-gray-50">No hay pagos registrados aún.</td></tr>`;
            return;
        }

        pageItems.forEach(item => {
            const payment = item;
            let date = '---';
            if (payment.paymentDate) {
                const parts = payment.paymentDate.split('-');
                if (parts.length === 3) date = `${parts[2]}/${parts[1]}/${parts[0]}`;
                else date = payment.paymentDate;
            } else if (payment.createdAt) {
                date = payment.createdAt.toDate().toLocaleDateString('es-CO');
            }
            const isSpecial = payment.isSpecial ? '<span class="inline-block bg-yellow-100 text-yellow-800 text-[9px] font-bold px-1.5 py-0.5 rounded ml-2 uppercase tracking-wide">Especial</span>' : '';
            
            const tr = document.createElement('tr');
            tr.className = "hover:bg-slate-50 transition-colors group";
            tr.innerHTML = `
                <td class="p-4 border-b border-gray-100">
                    <div class="flex justify-between items-start mb-1">
                        <span class="text-xs font-bold text-gray-500 font-mono">${date}</span>
                        <span class="text-sm font-black text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-md border border-indigo-100">${currencyFormatter.format(payment.monto)}</span>
                    </div>
                    <p class="text-xs text-gray-700 font-medium truncate max-w-[200px]">${payment.concepto} ${isSpecial}</p>
                    
                    <div class="flex justify-end gap-2 mt-3 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                         <button class="view-voucher-btn text-[10px] font-bold bg-white text-blue-600 border border-blue-200 px-3 py-1.5 rounded-lg hover:bg-blue-50 transition-colors shadow-sm flex items-center">
                            <i class="fa-regular fa-eye mr-1"></i> Ver
                         </button>
                         <button class="delete-payment-btn text-[10px] font-bold bg-white text-rose-500 border border-rose-200 px-3 py-1.5 rounded-lg hover:bg-rose-50 transition-colors shadow-sm flex items-center">
                            <i class="fa-solid fa-trash mr-1"></i>
                         </button>
                    </div>
                </td>`;
            
             const viewBtn = tr.querySelector('.view-voucher-btn');
             const delBtn = tr.querySelector('.delete-payment-btn');

             viewBtn.onclick = () => openPaymentVoucherModal(payment, user);
             
             delBtn.onclick = () => {
                 _openConfirmModal("¿Eliminar este registro de pago de forma permanente?", async() => {
                    try {
                        await deleteDoc(doc(db, "users", userId, "paymentHistory", payment.id));
                        window.showToast("Registro eliminado", "success");
                    } catch(e) {
                        console.error(e);
                        window.showToast("Error al eliminar", "error");
                    }
                 });
             };
             
             tableBody.appendChild(tr);
        });

        const totalPages = Math.ceil(paymentsList.length / itemsPerPage) || 1;
        const pageInfo = document.getElementById('individual-history-page-info');
        if (pageInfo) pageInfo.textContent = `Pág ${page} de ${totalPages}`;

        const prevBtn = document.getElementById('individual-history-prev-btn');
        const nextBtn = document.getElementById('individual-history-next-btn');
        if (prevBtn) prevBtn.disabled = (page === 1);
        if (nextBtn) nextBtn.disabled = (page === totalPages);
    };

    // Usamos la variable global de suscripción para poder limpiarla después
    unsubscribeEmpleadosTab = onSnapshot(q, (snapshot) => {
        if (snapshot.empty) {
            tableBody.innerHTML = `<tr><td class="p-8 text-center text-sm text-gray-400 border-b border-gray-50">No hay pagos registrados aún.</td></tr>`;
            const pageInfo = document.getElementById('individual-history-page-info');
            if (pageInfo) pageInfo.textContent = `Pág 1 de 1`;
            const prevBtn = document.getElementById('individual-history-prev-btn');
            const nextBtn = document.getElementById('individual-history-next-btn');
            if (prevBtn) prevBtn.disabled = true;
            if (nextBtn) nextBtn.disabled = true;
            return;
        }
        
        paymentsList = [];
        snapshot.forEach(docSnap => {
            paymentsList.push({ id: docSnap.id, ...docSnap.data() });
        });

        renderPage(currentPage);
    });

    // Delegación o listeners para los botones de paginación individual
    setTimeout(() => {
        const prevBtn = document.getElementById('individual-history-prev-btn');
        const nextBtn = document.getElementById('individual-history-next-btn');

        if (prevBtn) {
            prevBtn.onclick = () => {
                if (currentPage > 1) {
                    currentPage--;
                    renderPage(currentPage);
                }
            };
        }
        if (nextBtn) {
            nextBtn.onclick = () => {
                const totalPages = Math.ceil(paymentsList.length / itemsPerPage) || 1;
                if (currentPage < totalPages) {
                    currentPage++;
                    renderPage(currentPage);
                }
            };
        }
    }, 100);
}

// Función global o exportada para borrar
window.deletePayment = (uid, pid) => {
    _openConfirmModal("¿Eliminar registro de pago?", async() => {
        await deleteDoc(doc(db, "users", uid, "paymentHistory", pid));
    });
};

/**
 * Calcula la base para prestaciones (Prima/Cesantías)
 * Regla: Si cotiza mínimo -> (SMMLV + Aux). Si no -> (Sueldo + Aux si aplica).
 */

// ==========================================
// EXTRACTED: updatePaymentTotal
// ==========================================
function updatePaymentTotal() {
    const config = getPayrollConfig();
    if (!config || !config.salarioMinimo) {
        console.warn("Configuración de nómina no cargada. Los cálculos pueden ser incorrectos.");
        return;
    }

    const form = document.getElementById('payment-register-form');
    const salarioEl = document.getElementById('payment-salario-basico');
    const bonificacionEl = document.getElementById('payment-bonificacion-mes');
    const diasPagar = parseFloat(document.getElementById('payment-dias-pagar').value) || 0;
    const diasAuxTransporte = parseFloat(document.getElementById('payment-dias-aux-transporte')?.value || diasPagar) || 0;

    // --- INICIO DE MODIFICACIÓN (FASE 3) ---
    // 1. Obtener el checkbox de liquidación
    const liquidarCheckbox = document.getElementById('payment-liquidar-bonificacion');
    const liquidarBonificacion = liquidarCheckbox.checked; // true si está marcado
    // --- FIN DE MODIFICACIÓN ---

    // 2. Obtener valores MENSUALES
    const salarioMensual = parseFloat(salarioEl.dataset.value || 0);
    const auxTransporteMensual = parseFloat(salarioEl.dataset.auxTransporte || 0);

    // 3. Calcular valores PRORRATEADOS
    const salarioProrrateado = (salarioMensual / 30) * diasPagar;
    const auxTransporteProrrateado = (auxTransporteMensual / 30) * diasAuxTransporte;

    // Actualizar badges de visualización en tiempo real
    if (salarioEl) salarioEl.textContent = currencyFormatter.format(salarioProrrateado);
    const auxTransporteValorEl = document.getElementById('payment-aux-transporte-valor');
    if (auxTransporteValorEl) {
        auxTransporteValorEl.textContent = `Aux: ${currencyFormatter.format(auxTransporteProrrateado)}`;
    }

    // 4. Obtener valores que NO se prorratean
    const otros = parseFloat(document.getElementById('payment-otros').value.replace(/[$. ]/g, '')) || 0;

    let loanDeduction = 0;
    document.querySelectorAll('.loan-deduction-input').forEach(input => {
        const val = parseFloat(input.value.replace(/[$. ]/g, '')) || 0;
        loanDeduction += val;
    });

    // Actualizar el display del total a descontar en el fieldset
    const loanTotalDisplay = document.getElementById('payment-total-loan-deduction-display');
    if (loanTotalDisplay) loanTotalDisplay.textContent = currencyFormatter.format(loanDeduction);

    // --- INICIO DE MODIFICACIÓN (FASE 3) ---
    // 5. Determinar la bonificación a pagar
    const bonificacionPotencial = parseFloat(bonificacionEl.dataset.value || 0);
    let bonificacionAPagar = 0; // Por defecto es 0 (ej. primera quincena)

    // Solo incluimos la bonificación si el checkbox está marcado
    if (liquidarBonificacion) {
        bonificacionAPagar = bonificacionPotencial;
    }
    // --- FIN DE MODIFICACIÓN ---

    // 6. Calcular Horas Extra
    const horasExtra = parseFloat(document.getElementById('payment-horas-diurnas').value) || 0;
    const valorHora = (salarioMensual / 235);
    const multiplicador = config.multiplicadorHoraExtra || 1.25;
    const totalHorasExtra = (horasExtra * valorHora * multiplicador);

    document.getElementById('payment-total-horas').textContent = currencyFormatter.format(totalHorasExtra);

    // 7. Calcular Deducciones (usando bonificacionAPagar)
    const deduccionSobreMinimo = form.dataset.deduccionSobreMinimo === 'true';
    let baseDeduccion = 0;

    if (deduccionSobreMinimo) {
        baseDeduccion = (config.salarioMinimo / 30) * diasPagar;
    } else {
        // Base es: Básico + H.Extra + BONIFICACIÓN (solo si se paga)
        baseDeduccion = salarioProrrateado + totalHorasExtra + bonificacionAPagar;
    }

    if (baseDeduccion > 0 && baseDeduccion < (config.salarioMinimo / 30) * diasPagar) {
        baseDeduccion = (config.salarioMinimo / 30) * diasPagar;
    }

    const deduccionSalud = baseDeduccion * (config.porcentajeSalud / 100);
    const deduccionPension = baseDeduccion * (config.porcentajePension / 100);
    const totalDeducciones = deduccionSalud + deduccionPension;

    // 8. Calcular Total Final (usando bonificacionAPagar)
    const totalDevengado = salarioProrrateado + auxTransporteProrrateado + bonificacionAPagar + totalHorasExtra + otros;
    const totalPagar = totalDevengado - totalDeducciones - loanDeduction; // Se usa la suma calculada

    document.getElementById('payment-total-pagar').textContent = currencyFormatter.format(totalPagar);
}

/**
 * (FUNCIÓN COMPLETA CORREGIDA) Registra el pago, aplica deducciones y AMORTIZA PRÉSTAMOS.
 */

// ==========================================
// EXTRACTED: handleRegisterPayment
// ==========================================
async function handleRegisterPayment(e, userId) {
    e.preventDefault();
    const submitButton = document.getElementById('payment-submit-button');
    submitButton.disabled = true;
    submitButton.innerHTML = '<div class="loader-small-white mx-auto"></div>';

    const config = getPayrollConfig();
    
    // Función auxiliar para limpiar moneda
    const parseMoney = (idOrValue) => {
        let val = typeof idOrValue === 'string' ? idOrValue : document.getElementById(idOrValue).value;
        return parseFloat(val.replace(/[$. ]/g, '')) || 0;
    };

    try {
        const diasPagar = parseFloat(document.getElementById('payment-dias-pagar').value) || 0;
        const diasAuxTransporte = parseFloat(document.getElementById('payment-dias-aux-transporte')?.value || diasPagar) || 0;
        
        // 1. LEER DATOS BASE
        const salarioEl = document.getElementById('payment-salario-basico');
        const salarioMensual = parseFloat(salarioEl.dataset.value || 0);
        const auxTransporteMensual = parseFloat(salarioEl.dataset.auxTransporte || 0);

        // 2. CÁLCULOS PRORRATEADOS
        const salarioProrrateado = (salarioMensual / 30) * diasPagar;
        const auxTransporteProrrateado = (auxTransporteMensual / 30) * diasAuxTransporte;

        const otros = parseMoney('payment-otros');
        // Aseguramos leer el texto del span de horas
        const totalHorasExtra = parseMoney(document.getElementById('payment-total-horas').textContent); 
        const concepto = document.getElementById('payment-concepto').value;

        // 3. Préstamos
        let totalLoanDeduction = 0;
        const loanPayments = []; 
        document.querySelectorAll('.loan-deduction-input').forEach(input => {
            const val = parseFloat(input.value.replace(/[$. ]/g, '')) || 0;
            if (val > 0) {
                totalLoanDeduction += val;
                loanPayments.push({
                    loanId: input.dataset.loanId,
                    amount: val,
                    previousBalance: parseFloat(input.dataset.balance)
                });
            }
        });

        // 4. Bonificación
        const liquidarBonificacion = document.getElementById('payment-liquidar-bonificacion').checked;
        const bonificacionPotencial = parseFloat(document.getElementById('payment-bonificacion-mes').dataset.value || 0);
        const bonificacionPagada = liquidarBonificacion ? bonificacionPotencial : 0;

        // Validaciones
        if (!concepto) throw new Error("Ingresa un concepto.");
        if (diasPagar <= 0) throw new Error("Días a pagar inválidos.");

        // 5. Deducciones Ley
        const deduccionSobreMinimo = document.getElementById('payment-register-form').dataset.deduccionSobreMinimo === 'true';
        let baseDeduccion = 0;
        
        if (deduccionSobreMinimo && config.salarioMinimo) {
            baseDeduccion = (config.salarioMinimo / 30) * diasPagar;
        } else {
            baseDeduccion = salarioProrrateado + totalHorasExtra + bonificacionPagada;
        }

        // Validación extra para no cotizar por debajo del mínimo proporcional
        if (config.salarioMinimo && baseDeduccion > 0 && baseDeduccion < (config.salarioMinimo / 30) * diasPagar) {
            baseDeduccion = (config.salarioMinimo / 30) * diasPagar;
        }

        const deduccionSalud = baseDeduccion * (config.porcentajeSalud / 100);
        const deduccionPension = baseDeduccion * (config.porcentajePension / 100);
        const totalDeduccionesLey = deduccionSalud + deduccionPension;

        // 6. NETO FINAL
        const totalDevengado = salarioProrrateado + auxTransporteProrrateado + bonificacionPagada + totalHorasExtra + otros;
        const totalPagar = totalDevengado - totalDeduccionesLey - totalLoanDeduction;

        if (totalPagar < 0) {
            throw new Error(`El total es negativo ($${totalPagar.toLocaleString()}). Los descuentos superan el sueldo. Reduce el abono a préstamos.`);
        }

        // 7. Guardar
        const currentUserId = currentUser.uid();
        const usersMap = getUsersMap();
        const currentUser = usersMap.get(currentUserId);
        const registeredByName = currentUser ? `${currentUser.firstName} ${currentUser.lastName}` : 'Sistema';

        const paymentData = {
            userId: userId,
            paymentDate: new Date().toISOString().split('T')[0],
            concepto: concepto,
            monto: totalPagar,
            diasPagados: diasPagar,
            diasAuxTransporte: diasAuxTransporte,
            desglose: {
                salarioProrrateado: salarioProrrateado,
                auxilioTransporteProrrateado: auxTransporteProrrateado,
                diasAuxTransporte: diasAuxTransporte,
                bonificacionM2: bonificacionPagada,
                horasExtra: totalHorasExtra, 
                otros: otros, 
                abonoPrestamos: totalLoanDeduction,
                detallesPrestamos: loanPayments, 
                deduccionSalud: -deduccionSalud,
                deduccionPension: -deduccionPension, 
                baseDeduccion: baseDeduccion, 
                deduccionSobreMinimo: deduccionSobreMinimo
            },
            horas: { totalHorasExtra: parseFloat(document.getElementById('payment-horas-diurnas').value) || 0 },
            createdAt: serverTimestamp(),
            registeredBy: currentUserId,
            registeredByName: registeredByName
        };

        const batch = writeBatch(db);
        const paymentHistoryRef = doc(collection(db, "users", userId, "paymentHistory"));
        batch.set(paymentHistoryRef, paymentData);

        if (liquidarBonificacion) {
            const today = new Date();
            const currentStatDocId = `${today.getFullYear()}_${String(today.getMonth() + 1).padStart(2, '0')}`;
            const statRef = doc(db, "employeeStats", userId, "monthlyStats", currentStatDocId);
            batch.set(statRef, { bonificacionPagada: true }, { merge: true });
        }

        loanPayments.forEach(pago => {
            const loanRef = doc(db, "users", userId, "loans", pago.loanId);
            const newBalance = pago.previousBalance - pago.amount;
            const updateData = { balance: newBalance };
            if (newBalance <= 0) { updateData.status = 'paid'; updateData.paidAt = serverTimestamp(); }
            batch.update(loanRef, updateData);
        });

        await batch.commit();

        if(window.showToast) window.showToast("Pago registrado exitosamente.", "success");
        
        // Reset
        document.getElementById('payment-horas-diurnas').value = '0';
        document.getElementById('payment-otros').value = '$ 0';
        loadPaymentHistoryView(userId);

    } catch (error) {
        console.error(error);
        if(window.showToast) window.showToast(error.message, "error");
        else alert(error.message);
    } finally {
        submitButton.disabled = false;
        submitButton.innerHTML = '<i class="fa-solid fa-floppy-disk mr-2"></i>Registrar Pago';
    }
}


/**
 * Crea una ventana flotante temporal para pedir datos (Reemplazo de prompt)
 * Retorna una Promesa que se resuelve con el valor o null si cancela.
 */
