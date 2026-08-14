// js/modules/cotizaciones.js

import { db } from '../firebase-config.js';
import { 
    collection, doc, updateDoc, addDoc, deleteDoc, query, getDocs, where, 
    runTransaction, serverTimestamp, onSnapshot 
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";
import { 
    allClientes, allItems, allColores, allUsers,
    currentUser, currentUserData, 
    showModalMessage, hideModal, showTemporaryMessage, initSearchableInput,
    populateDateFilters, showPdfModal
} from '../app.js';
import { formatCurrency, unformatCurrency, unformatCurrencyInput, formatCurrencyInput } from '../utils.js';
import { ESTADOS_COTIZACION } from '../constants.js';

let localElementCounter = 0;

// --- CONFIGURACIÓN DE CACHÉ Y ESTADO ---
const CACHE_KEY = 'cotizaciones_cache';
const SYNC_KEY = 'cotizaciones_last_sync';

export let allCotizaciones = [];
export function setAllCotizaciones(val) { allCotizaciones = val; }

let currentPage = 1;
const itemsPerPage = 20;
let currentFilter = 'todas'; // 'todas', 'Pendiente', 'Aprobada', 'Convertida', 'Rechazada', 'archivadas'
let searchQuery = '';

// --- FORMATO DE FIRMA (NOMBRE + INICIAL DE APELLIDO + PUNTO) ---
export function formatUserSignature(fullName) {
    if (!fullName || typeof fullName !== 'string') return '';
    const clean = fullName.trim();
    if (!clean) return '';
    const parts = clean.split(/\s+/);
    if (parts.length === 1) return parts[0];
    const firstName = parts[0];
    const lastName = parts.length > 1 ? parts[parts.length - 1] : parts[1];
    const lastNameInitial = lastName ? lastName.charAt(0).toUpperCase() : '';
    return lastNameInitial ? `${firstName} ${lastNameInitial}.` : firstName;
}

// --- CARGA DE DATOS (CACHÉ + TIEMPO REAL) ---
export function loadCotizaciones() {
    const cachedData = localStorage.getItem(CACHE_KEY);
    let mapCotizaciones = new Map();
    let maxLastUpdated = 0;

    if (cachedData) {
        try {
            const parsedData = JSON.parse(cachedData);
            parsedData.forEach(c => {
                mapCotizaciones.set(c.id, c);
                if (c._lastUpdated && c._lastUpdated > maxLastUpdated) {
                    maxLastUpdated = c._lastUpdated;
                }
            });
            allCotizaciones = Array.from(mapCotizaciones.values());
            renderCotizaciones();
        } catch (e) {
            console.error("Error al leer caché de cotizaciones:", e);
        }
    }

    const cotizacionesCol = collection(db, "cotizaciones");
    let q;

    if (maxLastUpdated > 0) {
        const lastSyncDate = new Date(maxLastUpdated);
        q = query(cotizacionesCol, where("_lastUpdated", ">", lastSyncDate));
    } else {
        q = query(cotizacionesCol);
    }

    const unsubscribe = onSnapshot(q, (snapshot) => {
        if (!snapshot.empty) {
            snapshot.docChanges().forEach((change) => {
                const docData = change.doc.data();
                const cotizacionObj = {
                    id: change.doc.id,
                    ...docData,
                    _lastUpdated: docData._lastUpdated?.toMillis ? docData._lastUpdated.toMillis() : Date.now()
                };

                if (change.type === "added" || change.type === "modified") {
                    mapCotizaciones.set(cotizacionObj.id, cotizacionObj);
                }
                if (change.type === "removed") {
                    mapCotizaciones.delete(cotizacionObj.id);
                }
            });

            allCotizaciones = Array.from(mapCotizaciones.values());
            try {
                localStorage.setItem(CACHE_KEY, JSON.stringify(allCotizaciones));
                localStorage.setItem(SYNC_KEY, Date.now().toString());
            } catch (e) {
                console.warn("Storage lleno al guardar cotizaciones:", e);
            }
            renderCotizaciones();
        }
    }, (error) => {
        console.warn("Aviso en tiempo real de cotizaciones (revisar reglas de Firestore si es primera vez):", error.message);
    });

    return unsubscribe;
}

function updateLocalCache(updatedCotizacion) {
    const index = allCotizaciones.findIndex(c => c.id === updatedCotizacion.id);
    if (index !== -1) {
        allCotizaciones[index] = updatedCotizacion;
    } else {
        allCotizaciones.unshift(updatedCotizacion);
    }
    try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(allCotizaciones));
    } catch (e) {}
    renderCotizaciones();
}

// --- RENDERIZADO DE LA VISTA ---
export function renderCotizaciones() {
    const container = document.getElementById('cotizaciones-list-container');
    if (!container) return;

    const listEl = container.querySelector('#cotizaciones-list');
    const paginationEl = container.querySelector('#cotizaciones-pagination');
    if (!listEl) return;

    // Conteo de estados
    const counts = {
        todas: allCotizaciones.filter(c => !c.archivada).length,
        Pendiente: allCotizaciones.filter(c => !c.archivada && c.estado === 'Pendiente').length,
        Aprobada: allCotizaciones.filter(c => !c.archivada && c.estado === 'Aprobada').length,
        Convertida: allCotizaciones.filter(c => !c.archivada && c.estado === 'Convertida').length,
        Rechazada: allCotizaciones.filter(c => !c.archivada && c.estado === 'Rechazada').length,
        archivadas: allCotizaciones.filter(c => c.archivada).length
    };

    // Actualizar badges en botones de filtro si existen
    document.querySelectorAll('.cotizacion-filter-btn').forEach(btn => {
        const filterType = btn.dataset.filter;
        const countSpan = btn.querySelector('.filter-count');
        if (countSpan && counts[filterType] !== undefined) {
            countSpan.textContent = counts[filterType];
        }
        btn.classList.toggle('active-filter', filterType === currentFilter);
    });

    const monthFilter = document.getElementById('filter-month-cotizaciones')?.value;
    const yearFilter = document.getElementById('filter-year-cotizaciones')?.value;

    let filtered = allCotizaciones.filter(c => {
        // Filtro de archivadas
        if (currentFilter === 'archivadas') {
            if (!c.archivada) return false;
        } else {
            if (c.archivada) return false;
            if (currentFilter !== 'todas' && c.estado !== currentFilter) return false;
        }

        // Filtro de búsqueda
        if (searchQuery) {
            const queryNorm = searchQuery.toLowerCase().trim();
            const numStr = (c.numeroCotizacion || '').toString();
            const cliente = (c.clienteNombre || '').toLowerCase();
            const nit = (c.clienteNit || '').toLowerCase();
            if (!numStr.includes(queryNorm) && !cliente.includes(queryNorm) && !nit.includes(queryNorm)) {
                return false;
            }
        }

        // Filtro por Fecha
        if (c.fecha) {
            const dateParts = c.fecha.split('-');
            if (dateParts.length >= 3) {
                const cYear = parseInt(dateParts[0], 10);
                const cMonth = parseInt(dateParts[1], 10) - 1; // 0-indexado para coincidir con populateDateFilters (0=Enero..11=Diciembre)
                if (yearFilter && yearFilter !== 'all' && cYear !== parseInt(yearFilter, 10)) return false;
                if (monthFilter && monthFilter !== 'all' && cMonth !== parseInt(monthFilter, 10)) return false;
            }
        }

        return true;
    });

    // Ordenar descendente por número o fecha
    filtered.sort((a, b) => (b.numeroCotizacion || 0) - (a.numeroCotizacion || 0));

    // Paginación
    const totalPages = Math.ceil(filtered.length / itemsPerPage) || 1;
    if (currentPage > totalPages) currentPage = totalPages;
    const startIndex = (currentPage - 1) * itemsPerPage;
    const paginatedItems = filtered.slice(startIndex, startIndex + itemsPerPage);

    listEl.innerHTML = '';

    if (filtered.length === 0) {
        listEl.innerHTML = '<p class="text-center text-slate-500 py-8">No se encontraron cotizaciones.</p>';
        if (paginationEl) paginationEl.innerHTML = '';
        return;
    }

    paginatedItems.forEach((c) => {
        const el = document.createElement('div');
        const esRechazada = c.estado === 'Rechazada';
        const esConvertida = c.estado === 'Convertida';
        const esAprobada = c.estado === 'Aprobada';

        let cardColorClass = 'premium-card-indigo';
        if (esRechazada) cardColorClass = 'premium-card-red';
        else if (esAprobada) cardColorClass = 'premium-card-green';
        else if (esConvertida) cardColorClass = 'premium-card-purple';

        el.className = `premium-card ${cardColorClass} p-5 flex flex-col lg:flex-row justify-between lg:items-center gap-4 bg-white shadow-sm hover:shadow-md transition`;

        const statusClasses = {
            'Pendiente': 'status-recibido',
            'Aprobada': 'status-entregado',
            'Convertida': 'status-procesado',
            'Rechazada': 'status-anulada',
            'Archivada': 'status-en-proceso'
        };

        const statusBadge = `<span class="status-badge ${statusClasses[c.estado] || 'status-recibido'}">${c.estado}</span>`;
        const itemsCount = Array.isArray(c.items) ? c.items.length : 0;

        let remisionBadge = '';
        if (esConvertida) {
            const remNum = (c.numeroRemision && !isNaN(c.numeroRemision)) ? c.numeroRemision : '';
            if (remNum) {
                remisionBadge = `<span class="bg-indigo-50 text-indigo-700 text-xs font-bold px-2 py-0.5 rounded border border-indigo-200">Remisión N° ${remNum}</span>`;
            } else if (c.remisionId) {
                remisionBadge = `<span class="bg-indigo-50 text-indigo-700 text-xs font-bold px-2 py-0.5 rounded border border-indigo-200">Remisión Convertida</span>`;
            }
        }

        let versionBadge = '';
        const prevCount = (c.historialVersiones || []).length;
        if ((c.version && c.version > 1) || prevCount > 0) {
            versionBadge = `<button data-id="${c.id}" class="version-history-btn bg-sky-50 hover:bg-sky-100 text-sky-700 text-xs font-bold px-2.5 py-0.5 rounded-full border border-sky-200 transition flex items-center gap-1 shadow-xs" title="Ver historial de versiones"><i class="fa-solid fa-clock-rotate-left text-[10px]"></i> v${c.version || 1} (${prevCount} previa${prevCount !== 1 ? 's' : ''})</button>`;
        }

        const pdfButton = `<button data-id="${c.id}" class="pdf-cot-btn w-full bg-green-600 hover:bg-green-700 text-white px-4 py-2.5 rounded-lg text-sm font-semibold transition text-center shadow-sm flex items-center justify-center gap-1.5"><i class="fa-solid fa-file-pdf"></i> Ver PDF</button>`;
        const editButton = esConvertida ? '' : `<button data-id="${c.id}" class="edit-cot-btn w-full bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 px-4 py-2.5 rounded-lg text-sm font-semibold transition shadow-sm flex items-center justify-center gap-1.5"><i class="fa-solid fa-pen-to-square"></i> Editar</button>`;
        const escalarButton = esConvertida ? '' : `<button data-id="${c.id}" class="escalar-cot-btn w-full bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-lg text-sm font-semibold transition shadow-sm flex items-center justify-center gap-1.5"><i class="fa-solid fa-rocket text-amber-300"></i> Escalar</button>`;
        const opcionesButton = `<button data-id="${c.id}" class="options-cot-btn w-full bg-slate-800 hover:bg-slate-900 text-white px-4 py-2.5 rounded-lg text-sm font-semibold transition shadow-sm flex items-center justify-center gap-1.5"><i class="fa-solid fa-ellipsis-vertical"></i> Opciones</button>`;

        el.innerHTML = `
            <div class="flex-grow min-w-0 text-left">
                <div class="flex items-center gap-3 flex-wrap">
                    <span class="remision-id font-bold text-slate-800">COT-${c.numeroCotizacion}</span>
                    <p class="font-bold text-lg text-slate-900 truncate" title="${c.clienteNombre || 'Sin Cliente'}">${c.clienteNombre || 'Sin Cliente'}</p>
                    ${statusBadge} ${remisionBadge} ${versionBadge}
                    ${c.archivada ? '<span class="px-2.5 py-0.5 bg-slate-200 text-slate-700 text-[10px] font-extrabold border border-slate-300 rounded-full">ARCHIVADA</span>' : ''}
                </div>
                <p class="text-xs text-slate-500 mt-2 font-medium">
                    Fecha: ${c.fecha || 'N/A'} &bull; Validez: ${c.validez || 15} días &bull; ${itemsCount} ítem${itemsCount !== 1 ? 's' : ''}
                    ${c.clienteTelefono ? `&bull; Tel: ${c.clienteTelefono}` : ''}
                </p>
                <p class="text-xs text-slate-600 mt-1 font-semibold">
                    Monto Total: <span class="text-sm font-extrabold text-indigo-650">${formatCurrency(c.valorTotal || 0)}</span>
                    ${c.incluyeIVA ? '<span class="text-[10px] text-slate-400 font-bold ml-1">(IVA Incluido)</span>' : ''}
                </p>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 flex-shrink-0 w-full sm:max-w-xs mt-2 lg:mt-0">
                ${pdfButton}
                ${escalarButton}
                ${editButton}
                ${opcionesButton}
            </div>
        `;
        listEl.appendChild(el);
    });

    // Paginación con estilo idéntico a remisiones
    if (paginationEl) {
        paginationEl.className = 'premium-pagination-container flex justify-between items-center mt-6';
        paginationEl.innerHTML = `
            <span class="text-xs font-medium text-slate-500">Mostrando ${startIndex + 1} - ${Math.min(startIndex + itemsPerPage, filtered.length)} de ${filtered.length} cotizaciones</span>
            <div class="flex gap-2">
                <button id="prev-page-cot-btn" class="premium-pagination-btn" ${currentPage === 1 ? 'disabled' : ''}>&larr; Anterior</button>
                <span class="px-3 py-1 text-xs font-bold text-slate-700 flex items-center bg-slate-50 border rounded-full">Pág ${currentPage} de ${totalPages}</span>
                <button id="next-page-cot-btn" class="premium-pagination-btn" ${currentPage === totalPages ? 'disabled' : ''}>Siguiente &rarr;</button>
            </div>
        `;

        paginationEl.querySelector('#prev-page-cot-btn')?.addEventListener('click', () => {
            if (currentPage > 1) { currentPage--; renderCotizaciones(); }
        });
        paginationEl.querySelector('#next-page-cot-btn')?.addEventListener('click', () => {
            if (currentPage < totalPages) { currentPage++; renderCotizaciones(); }
        });
    }

    attachCardEvents(listEl);
}

function attachCardEvents(listEl) {
    // Ver PDF (Formato Oficial)
    listEl.querySelectorAll('.pdf-cot-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.dataset.id;
            const cotizacion = allCotizaciones.find(c => c.id === id);
            if (cotizacion) generateCotizacionPdf(cotizacion);
        });
    });

    // Historial de versiones desde el badge
    listEl.querySelectorAll('.version-history-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = btn.dataset.id;
            const cotizacion = allCotizaciones.find(c => c.id === id);
            if (cotizacion) showCotizacionVersionHistoryModal(cotizacion);
        });
    });

    // Editar Cotización
    listEl.querySelectorAll('.edit-cot-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.dataset.id;
            const cotizacion = allCotizaciones.find(c => c.id === id);
            if (cotizacion) showEditCotizacionModal(cotizacion);
        });
    });

    // Escalar a Remisión
    listEl.querySelectorAll('.escalar-cot-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.dataset.id;
            handleEscalarARemision(id);
        });
    });

    // Menú de opciones adicionales (Estados / Archivar / Duplicar / Versiones)
    listEl.querySelectorAll('.options-cot-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = btn.dataset.id;
            const cotizacion = allCotizaciones.find(c => c.id === id);
            if (cotizacion) showCotizacionActionsModal(cotizacion);
        });
    });
}

// --- GENERADOR PDF OFICIAL DE COTIZACIÓN (FORMATO REMISIÓN & VERSIONES) ---
export function generateCotizacionPdf(c, customVersion = null) {
    if (!window.jspdf || !window.jspdf.jsPDF) {
        if (window.Swal) window.Swal.fire('Error', 'Librería jsPDF no disponible.', 'error');
        else showModalMessage("Error: jsPDF no está cargado.");
        return;
    }

    const data = customVersion || c;
    const isPreviousVersion = !!customVersion;
    const versionNumber = customVersion ? (customVersion.version || 1) : (c.version || 1);

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    // 1. MARCA DE AGUA SI ES VERSIÓN ANTERIOR, RECHAZADA O ARCHIVADA
    if (isPreviousVersion) {
        doc.setFontSize(40);
        doc.setTextColor(215, 220, 235);
        doc.text(`VERSIÓN ANTERIOR (v${versionNumber})`, 105, 140, { align: "center", angle: 45 });
    } else if (c.estado === 'Rechazada' || c.archivada) {
        doc.setFontSize(55);
        doc.setTextColor(240, 200, 200);
        doc.text(c.estado === 'Rechazada' ? "RECHAZADA" : "ARCHIVADA", 105, 140, { align: "center", angle: 45 });
    }

    // 2. ENCABEZADO IZQUIERDO (DATOS DE LA EMPRESA)
    doc.setFont("helvetica", "bold");
    doc.setFontSize(24);
    doc.setTextColor(33, 37, 41); // Dark charcoal grey
    doc.text("PRISMACOLOR", 15, 22);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(108, 117, 125);
    doc.text("Tels: 313 2522810 – 310 2557543", 15, 28);
    doc.text("Cra 27A No. 68-80", 15, 33);
    doc.text("Pintura Electrostática & Servicios Industriales", 15, 38);

    // 3. ENCABEZADO DERECHO (DATOS DE LA COTIZACIÓN)
    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.setTextColor(33, 37, 41);
    doc.text("COTIZACIÓN", 195, 22, { align: "right" });

    doc.setFontSize(19);
    doc.setTextColor(230, 120, 23); // Color naranja de marca
    const cotLabel = `#COT-${c.numeroCotizacion}${versionNumber > 1 || isPreviousVersion ? ` (v${versionNumber})` : ''}`;
    doc.text(cotLabel, 195, 29, { align: "right" });

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(108, 117, 125);
    doc.text(`Fecha: ${data.fecha || c.fecha || ""}`, 195, 35, { align: "right" });
    doc.text(`Validez: ${data.validez || c.validez || 15} días`, 195, 40, { align: "right" });

    // 4. LÍNEA SEPARADORA PRINCIPAL
    doc.setDrawColor(33, 37, 41);
    doc.setLineWidth(0.8);
    doc.line(15, 44, 195, 44);

    // 5. INFORMACIÓN DEL CLIENTE
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(108, 117, 125);
    doc.text("INFORMACIÓN DEL CLIENTE", 15, 51);

    doc.setDrawColor(220, 224, 230);
    doc.setLineWidth(0.2);
    doc.line(15, 53, 195, 53);

    // Fila 1 de Datos de Cliente
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(108, 117, 125);
    doc.text("CLIENTE", 15, 60);
    doc.text("TELÉFONO", 110, 60);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(33, 37, 41);
    doc.text(String(data.clienteNombre || c.clienteNombre || "N/A"), 15, 65);
    doc.text(String(data.clienteTelefono || c.clienteTelefono || "N/A"), 110, 65);

    // Fila 2 de Datos de Cliente
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(108, 117, 125);
    doc.text("IDENTIFICACIÓN (NIT / CC)", 15, 73);
    doc.text("CORREO ELECTRÓNICO", 110, 73);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(33, 37, 41);
    doc.text(String(data.clienteNit || c.clienteNit || "N/A"), 15, 78);
    doc.text(String(data.clienteEmail || c.clienteEmail || "N/A"), 110, 78);

    // 6. TABLA DE ÍTEMS
    const tableColumn = ["Referencia", "Descripción", "Color", "Cant.", "Vlr. Unit.", "Subtotal"];
    const items = Array.isArray(data.items) ? data.items : [];

    const tableRows = items.map((item) => {
        const ref = item.referencia || item.descripcion || 'Ítem';
        const desc = item.descripcion && item.referencia && item.descripcion !== item.referencia ? item.descripcion : (item.descripcion || item.referencia || '-');
        const color = item.color || 'Estándar / Por Definir';
        const cant = item.cantidad || 1;
        const vUnit = item.valorUnitario || 0;
        const sub = item.valorTotal || (cant * vUnit);

        return [ref, desc, color, cant, formatCurrency(vUnit), formatCurrency(sub)];
    });

    doc.autoTable({
        head: [tableColumn],
        body: tableRows,
        startY: 85,
        theme: "striped",
        headStyles: { fillColor: [230, 120, 23], textColor: [255, 255, 255], fontStyle: "bold", fontSize: 9 },
        bodyStyles: { textColor: [33, 37, 41], fontSize: 9 },
        alternateRowStyles: { fillColor: [248, 249, 250] },
        styles: { cellPadding: 3 },
        columnStyles: {
            0: { cellWidth: 25 },
            1: { cellWidth: 65 },
            2: { cellWidth: 30 },
            3: { cellWidth: 15, halign: "center" },
            4: { cellWidth: 22, halign: "right" },
            5: { cellWidth: 23, halign: "right" }
        }
    });

    // 7. TOTALES Y CONDICIONES (CON ESPACIADO GENEROSO)
    const finalY = doc.lastAutoTable.finalY;
    let sectionStartY = finalY + 16;

    if (sectionStartY > 195) {
        doc.addPage();
        sectionStartY = 25;
    }

    // Cuadro de Totales (Alineado a la derecha)
    const rightLabelsX = 125;
    const rightValuesX = 195;
    let yPos = sectionStartY;

    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(108, 117, 125);
    doc.text("Subtotal:", rightLabelsX, yPos);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(33, 37, 41);
    doc.text(formatCurrency(data.subtotal || 0), rightValuesX, yPos, { align: "right" });
    yPos += 7;

    if (data.incluyeIVA) {
        doc.setFont("helvetica", "bold");
        doc.setTextColor(108, 117, 125);
        doc.text("IVA (19%):", rightLabelsX, yPos);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(33, 37, 41);
        doc.text(formatCurrency(data.valorIVA || 0), rightValuesX, yPos, { align: "right" });
        yPos += 7;
    }

    // Línea separadora previa al total
    doc.setDrawColor(220, 224, 230);
    doc.setLineWidth(0.3);
    doc.line(rightLabelsX, yPos - 1.5, rightValuesX, yPos - 1.5);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(33, 37, 41);
    doc.text("TOTAL COTIZADO:", rightLabelsX, yPos + 4);
    doc.setTextColor(230, 120, 23); // Color naranja de marca
    doc.text(formatCurrency(data.valorTotal || 0), rightValuesX, yPos + 4, { align: "right" });

    // Términos y Observaciones (Alineado a la izquierda)
    let leftInfoY = sectionStartY;

    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(108, 117, 125);
    doc.text("Términos & Observaciones:", 15, leftInfoY);
    
    const obsText = data.observaciones && data.observaciones.trim() !== ""
        ? data.observaciones
        : "Precios sujetos a confirmación de especificaciones técnicas al momento del ingreso. Oferta válida por " + (data.validez || 15) + " días a partir de la fecha de emisión.";
    
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(75, 85, 99);
    const textoObs = doc.splitTextToSize(obsText, 100);
    doc.text(textoObs, 15, leftInfoY + 5);

    // Estado y Validez
    const estadoY = leftInfoY + (textoObs.length * 4.2) + 8;
    doc.setFontSize(8.5);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(108, 117, 125);
    doc.text(`Estado de la Propuesta:`, 15, estadoY);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(33, 37, 41);
    doc.text(`${c.estado || 'Pendiente'}${isPreviousVersion ? ` (Copia de Versión ${versionNumber})` : ''}`, 55, estadoY);

    // 8. FIRMA (SOLO NOMBRE E INICIAL DE APELLIDO, SIN LÍNEA NI CARGO)
    let creatorFullName = customVersion ? (customVersion.editadoPor || c.creadorNombre || '') : (c.creadorNombre || '');
    if (!creatorFullName && c.creadoPor) {
        const u = (allUsers || []).find(user => user.id === c.creadoPor);
        if (u && u.nombre) creatorFullName = u.nombre;
    }
    if (!creatorFullName && currentUserData?.nombre) {
        creatorFullName = currentUserData.nombre;
    }
    if (!creatorFullName && currentUser?.displayName) {
        creatorFullName = currentUser.displayName;
    }
    if (!creatorFullName) {
        creatorFullName = 'Jonny Guerrero';
    }

    const firmaNombre = formatUserSignature(creatorFullName);

    if (firmaNombre) {
        const firmaY = Math.max(yPos + 18, estadoY + 16);

        if (firmaY > 270) {
            doc.addPage();
            doc.setFont("helvetica", "bold");
            doc.setFontSize(11);
            doc.setTextColor(33, 37, 41);
            doc.text(firmaNombre, 15, 30);
        } else {
            doc.setFont("helvetica", "bold");
            doc.setFontSize(11);
            doc.setTextColor(33, 37, 41);
            doc.text(firmaNombre, 15, firmaY);
        }
    }

    // Generar Blob y abrir en Visor PDF
    const pdfBlob = doc.output('blob');
    const pdfUrl = URL.createObjectURL(pdfBlob);
    showPdfModal(pdfUrl, `Cotización N° COT-${c.numeroCotizacion}${isPreviousVersion ? ` (v${versionNumber})` : ''}`);
}

// --- MODAL DE HISTORIAL DE VERSIONES ---
export function showCotizacionVersionHistoryModal(c) {
    const modal = document.getElementById('modal');
    const modalContentWrapper = document.getElementById('modal-content-wrapper');
    if (!modal || !modalContentWrapper) return;

    const historial = Array.isArray(c.historialVersiones) ? [...c.historialVersiones] : [];
    historial.sort((a, b) => (b.version || 0) - (a.version || 0));

    const currentVersionNum = c.version || (historial.length + 1);

    const prevVersionsRows = historial.length === 0 ? `
        <div class="p-6 text-center text-slate-400 text-xs bg-slate-50 rounded-xl border border-dashed border-slate-200">
            <i class="fa-solid fa-clock-rotate-left text-2xl mb-2 text-slate-300 block"></i>
            Esta cotización no tiene versiones anteriores guardadas. Cada vez que la edites, se archivará automáticamente una versión aquí.
        </div>
    ` : historial.map((v) => {
        const vItems = Array.isArray(v.items) ? v.items : [];
        const itemsSummary = vItems.map(it => `${it.cantidad}x ${it.referencia || it.descripcion || 'Ítem'}`).join(', ');
        const fechaFormateada = v.fechaEdicion ? new Date(v.fechaEdicion).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' }) : (v.fecha || 'N/A');

        return `
            <div class="bg-white p-4 rounded-xl border border-slate-200 hover:border-sky-300 shadow-xs space-y-3 transition">
                <div class="flex items-center justify-between flex-wrap gap-2">
                    <div class="flex items-center gap-2">
                        <span class="bg-sky-100 text-sky-800 text-xs font-black px-2.5 py-0.5 rounded-full border border-sky-200">
                            Versión ${v.version}
                        </span>
                        <span class="text-xs text-slate-500 font-medium">
                            <i class="fa-regular fa-clock mr-1 text-slate-400"></i>${fechaFormateada}
                        </span>
                    </div>
                    <div class="text-right">
                        <span class="text-xs font-bold text-slate-400 block uppercase text-[10px]">Total de esta versión</span>
                        <span class="text-sm font-black text-slate-800">${formatCurrency(v.valorTotal || 0)}</span>
                    </div>
                </div>

                <div class="bg-slate-50 p-2.5 rounded-lg border border-slate-100 text-xs text-slate-600 space-y-1">
                    <div class="flex justify-between items-center text-[11px]">
                        <span class="font-semibold text-slate-500">Editado por: <b class="text-slate-700">${v.editadoPor || 'Usuario'}</b></span>
                        <span class="font-semibold text-slate-500">${vItems.length} ítem${vItems.length !== 1 ? 's' : ''} ${v.incluyeIVA ? '(Con IVA)' : ''}</span>
                    </div>
                    <p class="text-[11px] text-slate-500 truncate" title="${itemsSummary}"><b>Ítems:</b> ${itemsSummary || 'Sin ítems'}</p>
                    ${v.observaciones ? `<p class="text-[10px] text-slate-400 italic truncate">"${v.observaciones}"</p>` : ''}
                </div>

                <div class="flex justify-end gap-2 pt-1">
                    <button data-vnum="${v.version}" class="view-version-pdf-btn bg-sky-50 hover:bg-sky-100 text-sky-800 font-bold px-3 py-1.5 rounded-lg text-xs border border-sky-200 transition flex items-center gap-1.5">
                        <i class="fa-solid fa-file-pdf text-sky-600"></i> Ver PDF v${v.version}
                    </button>
                    <button data-vnum="${v.version}" class="restore-version-btn bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold px-3 py-1.5 rounded-lg text-xs border border-slate-200 transition flex items-center gap-1.5">
                        <i class="fa-solid fa-rotate-left text-slate-500"></i> Restaurar v${v.version}
                    </button>
                </div>
            </div>
        `;
    }).join('');

    modalContentWrapper.innerHTML = `
        <div class="bg-white rounded-2xl max-w-2xl w-full mx-auto overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
            <div class="bg-slate-900 text-white p-5 flex justify-between items-center">
                <div class="flex items-center gap-3">
                    <div class="bg-sky-600 p-2 rounded-xl text-white font-bold">
                        <i class="fa-solid fa-clock-rotate-left"></i>
                    </div>
                    <div>
                        <h2 class="text-lg font-black tracking-tight">Historial de Versiones - COT-${c.numeroCotizacion}</h2>
                        <p class="text-xs text-slate-400">Consulta y descarga cualquier versión histórica de esta cotización.</p>
                    </div>
                </div>
                <button id="close-history-modal" class="text-slate-400 hover:text-white text-2xl font-bold transition">&times;</button>
            </div>

            <div class="p-6 overflow-y-auto flex-grow space-y-4">
                <!-- Versión Actual Activa -->
                <div class="bg-emerald-50/60 p-4 rounded-xl border border-emerald-200 shadow-xs space-y-3">
                    <div class="flex items-center justify-between flex-wrap gap-2">
                        <div class="flex items-center gap-2">
                            <span class="bg-emerald-600 text-white text-xs font-black px-3 py-0.5 rounded-full shadow-xs">
                                Versión Actual (v${currentVersionNum}) • ACTIVA
                            </span>
                            <span class="text-xs text-slate-500 font-medium">
                                ${c.fechaUltimaEdicion ? new Date(c.fechaUltimaEdicion).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' }) : (c.fecha || 'N/A')}
                            </span>
                        </div>
                        <div class="text-right">
                            <span class="text-xs font-bold text-slate-400 block uppercase text-[10px]">Total Actual</span>
                            <span class="text-base font-black text-emerald-800">${formatCurrency(c.valorTotal || 0)}</span>
                        </div>
                    </div>
                    <div class="flex justify-between items-center text-xs text-slate-600">
                        <span>Responsable: <b class="text-slate-800">${c.ultimaEdicionPor || c.creadorNombre || 'Usuario'}</b></span>
                        <button id="view-current-pdf-btn" class="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-3 py-1.5 rounded-lg text-xs shadow-xs transition flex items-center gap-1.5">
                            <i class="fa-solid fa-file-pdf"></i> Ver PDF Actual
                        </button>
                    </div>
                </div>

                <div class="pt-2">
                    <h3 class="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Versiones Anteriores Guardadas (${historial.length})</h3>
                    <div class="space-y-3">
                        ${prevVersionsRows}
                    </div>
                </div>
            </div>

            <div class="bg-slate-100 p-4 border-t border-slate-200 flex justify-end">
                <button id="close-history-modal-btn" class="bg-slate-800 hover:bg-slate-900 text-white font-bold py-2 px-5 rounded-xl text-xs transition">
                    Cerrar
                </button>
            </div>
        </div>
    `;

    modal.classList.remove('hidden');

    const closeModal = () => {
        modal.classList.add('hidden');
        modalContentWrapper.innerHTML = '';
    };

    modalContentWrapper.querySelector('#close-history-modal')?.addEventListener('click', closeModal);
    modalContentWrapper.querySelector('#close-history-modal-btn')?.addEventListener('click', closeModal);

    modalContentWrapper.querySelector('#view-current-pdf-btn')?.addEventListener('click', () => {
        closeModal();
        generateCotizacionPdf(c);
    });

    modalContentWrapper.querySelectorAll('.view-version-pdf-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const vNum = parseInt(btn.dataset.vnum, 10);
            const targetVersion = historial.find(h => h.version === vNum);
            if (targetVersion) {
                generateCotizacionPdf(c, targetVersion);
            }
        });
    });

    modalContentWrapper.querySelectorAll('.restore-version-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const vNum = parseInt(btn.dataset.vnum, 10);
            const targetVersion = historial.find(h => h.version === vNum);
            if (!targetVersion) return;

            if (confirm(`¿Deseas restaurar los ítems y valores de la Versión ${vNum} a la cotización activa?\n\nLa versión actual se guardará en el historial antes de restaurar.`)) {
                try {
                    showModalMessage("Restaurando versión...", true);

                    const curV = c.version || 1;
                    const backupSnapshot = {
                        version: curV,
                        fechaEdicion: new Date().toISOString(),
                        fecha: c.fecha || new Date().toISOString().split('T')[0],
                        editadoPor: currentUserData?.nombre || currentUser?.displayName || 'Usuario',
                        idCliente: c.idCliente || null,
                        clienteNombre: c.clienteNombre || '',
                        clienteNit: c.clienteNit || '',
                        clienteEmail: c.clienteEmail || '',
                        clienteTelefono: c.clienteTelefono || '',
                        validez: c.validez || 15,
                        items: JSON.parse(JSON.stringify(c.items || [])),
                        subtotal: c.subtotal || 0,
                        incluyeIVA: !!c.incluyeIVA,
                        valorIVA: c.valorIVA || 0,
                        valorTotal: c.valorTotal || 0,
                        observaciones: c.observaciones || ''
                    };

                    const nuevoHistorial = [...(c.historialVersiones || []), backupSnapshot];
                    const nuevaVersionNum = curV + 1;

                    const restoredData = {
                        idCliente: targetVersion.idCliente || c.idCliente || null,
                        clienteNombre: targetVersion.clienteNombre || c.clienteNombre || '',
                        clienteNit: targetVersion.clienteNit || c.clienteNit || '',
                        clienteEmail: targetVersion.clienteEmail || c.clienteEmail || '',
                        clienteTelefono: targetVersion.clienteTelefono || c.clienteTelefono || '',
                        validez: targetVersion.validez || c.validez || 15,
                        items: JSON.parse(JSON.stringify(targetVersion.items || [])),
                        subtotal: targetVersion.subtotal || 0,
                        incluyeIVA: !!targetVersion.incluyeIVA,
                        valorIVA: targetVersion.valorIVA || 0,
                        valorTotal: targetVersion.valorTotal || 0,
                        observaciones: targetVersion.observaciones || c.observaciones || '',
                        version: nuevaVersionNum,
                        historialVersiones: nuevoHistorial,
                        ultimaEdicionPor: currentUserData?.nombre || currentUser?.displayName || 'Usuario',
                        fechaUltimaEdicion: new Date().toISOString(),
                        _lastUpdated: serverTimestamp()
                    };

                    await updateDoc(doc(db, "cotizaciones", c.id), restoredData);
                    Object.assign(c, restoredData);
                    updateLocalCache(c);

                    closeModal();
                    hideModal();
                    renderCotizaciones();
                    showTemporaryMessage(`¡Cotización restaurada exitosamente a partir de la Versión ${vNum}!`, "success");

                } catch (err) {
                    hideModal();
                    showModalMessage("Error al restaurar versión: " + err.message);
                }
            }
        });
    });
}

// --- MODAL DE EDICIÓN DE COTIZACIÓN ---
export function showEditCotizacionModal(c) {
    const modal = document.getElementById('modal');
    const modalContentWrapper = document.getElementById('modal-content-wrapper');
    if (!modal || !modalContentWrapper) return;

    modalContentWrapper.innerHTML = `
        <div class="bg-white rounded-2xl max-w-4xl w-full mx-auto overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
            <div class="bg-slate-900 text-white p-5 flex justify-between items-center">
                <div class="flex items-center gap-3">
                    <div class="bg-amber-500 p-2 rounded-xl text-slate-950 font-bold">
                        <i class="fa-solid fa-pen-to-square"></i>
                    </div>
                    <div>
                        <h2 class="text-lg font-black tracking-tight">Editar Cotización N° ${c.numeroCotizacion}</h2>
                        <p class="text-xs text-slate-400">Modifica los ítems, valores o datos comerciales (Se guardará una versión de respaldo).</p>
                    </div>
                </div>
                <button id="close-edit-cot-btn" class="text-slate-400 hover:text-white text-2xl font-bold transition">&times;</button>
            </div>

            <div class="p-6 overflow-y-auto flex-grow space-y-5">
                <form id="edit-cotizacion-form" class="space-y-4">
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div class="relative">
                            <label class="block text-xs font-semibold text-slate-600 uppercase mb-1">Cliente</label>
                            <input type="text" id="edit-cot-cliente-input" class="w-full p-3 border border-gray-300 rounded-lg text-sm font-semibold" value="${c.clienteNombre || ''}" placeholder="Buscar cliente..." autocomplete="off" required>
                            <input type="hidden" id="edit-cot-cliente-id" value="${c.idCliente || ''}">
                            <div id="edit-cot-cliente-list" class="search-results hidden"></div>
                        </div>
                        <div>
                            <label class="block text-xs font-semibold text-slate-600 uppercase mb-1">Validez de la Oferta (Días)</label>
                            <input type="number" id="edit-cot-validez" class="w-full p-3 border border-gray-300 rounded-lg text-sm font-semibold" min="1" max="90" value="${c.validez || 15}" required>
                        </div>
                    </div>

                    <div>
                        <div class="flex justify-between items-center mb-2">
                            <label class="block text-xs font-semibold text-slate-600 uppercase">Ítems Cotizados</label>
                            <button type="button" id="edit-add-item-row-btn" class="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-extrabold text-xs px-3 py-1.5 rounded-lg border border-indigo-200 transition flex items-center gap-1">
                                <i class="fa-solid fa-plus text-[10px]"></i> Añadir Ítem
                            </button>
                        </div>
                        <div id="edit-cot-items-container" class="space-y-3"></div>
                    </div>

                    <div>
                        <label class="block text-xs font-semibold text-slate-600 uppercase mb-1">Observaciones / Términos</label>
                        <textarea id="edit-cot-observaciones" rows="2" class="w-full p-3 border border-gray-300 rounded-lg text-sm" placeholder="Añade términos, condiciones o detalles especiales...">${c.observaciones || ''}</textarea>
                    </div>

                    <div class="bg-slate-50 p-4 rounded-xl space-y-2 border border-slate-200">
                        <div class="flex justify-between items-center text-xs">
                            <span class="font-semibold text-slate-600">Subtotal:</span>
                            <span id="edit-cot-subtotal-display" class="font-bold text-slate-900">${formatCurrency(c.subtotal || 0)}</span>
                        </div>
                        <div class="flex justify-between items-center text-xs">
                            <label for="edit-cot-incluir-iva" class="flex items-center space-x-2 cursor-pointer my-0">
                                <input type="checkbox" id="edit-cot-incluir-iva" class="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" ${c.incluyeIVA ? 'checked' : ''}>
                                <span class="font-bold text-slate-700">Incluir IVA (19%)</span>
                            </label>
                            <span id="edit-cot-iva-display" class="font-semibold text-slate-600">${formatCurrency(c.valorIVA || 0)}</span>
                        </div>
                        <hr class="border-slate-200">
                        <div class="flex justify-between items-center text-base">
                            <span class="font-extrabold text-slate-800">TOTAL COTIZADO:</span>
                            <span id="edit-cot-total-display" class="font-black text-indigo-700 text-lg">${formatCurrency(c.valorTotal || 0)}</span>
                        </div>
                    </div>

                    <div class="flex justify-end gap-3 pt-2">
                        <button type="button" id="edit-cot-cancel-btn" class="bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-2.5 px-5 rounded-xl text-xs transition">
                            Cancelar
                        </button>
                        <button type="submit" id="edit-cot-submit-btn" class="bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold py-2.5 px-6 rounded-xl text-xs transition shadow-sm flex items-center gap-2">
                            <i class="fa-solid fa-floppy-disk"></i> Guardar Cambios
                        </button>
                    </div>
                </form>
            </div>
        </div>
    `;

    modal.classList.remove('hidden');

    const closeModal = () => {
        modal.classList.add('hidden');
        modalContentWrapper.innerHTML = '';
    };

    modalContentWrapper.querySelector('#close-edit-cot-btn')?.addEventListener('click', closeModal);
    modalContentWrapper.querySelector('#edit-cot-cancel-btn')?.addEventListener('click', closeModal);

    // Autocompletado de cliente en edición
    const editClienteInput = modalContentWrapper.querySelector('#edit-cot-cliente-input');
    const editClienteId = modalContentWrapper.querySelector('#edit-cot-cliente-id');
    const editClienteList = modalContentWrapper.querySelector('#edit-cot-cliente-list');
    if (editClienteInput && editClienteId && editClienteList) {
        initSearchableInput(
            editClienteInput,
            editClienteList,
            () => allClientes,
            (cli) => cli.nombreEmpresa ? `${cli.nombreEmpresa} (${cli.nombre})` : cli.nombre,
            (selectedCli) => {
                if (selectedCli) {
                    editClienteInput.value = selectedCli.nombreEmpresa ? `${selectedCli.nombreEmpresa} (${selectedCli.nombre})` : selectedCli.nombre;
                    editClienteId.value = selectedCli.id;
                } else {
                    editClienteId.value = '';
                }
            }
        );
    }

    // Renderizar filas de ítems en edición
    const itemsContainer = modalContentWrapper.querySelector('#edit-cot-items-container');
    const addItemBtn = modalContentWrapper.querySelector('#edit-add-item-row-btn');
    const ivaCheckbox = modalContentWrapper.querySelector('#edit-cot-incluir-iva');

    function calcEditTotals() {
        let sub = 0;
        itemsContainer.querySelectorAll('.edit-item-row').forEach(r => {
            const cant = parseInt(r.querySelector('.edit-item-cant').value) || 0;
            const val = unformatCurrency(r.querySelector('.edit-item-unit').value);
            sub += cant * val;
            r.querySelector('.edit-item-total').textContent = formatCurrency(cant * val);
        });
        const incIva = ivaCheckbox.checked;
        const vIva = incIva ? Math.round(sub * 0.19) : 0;
        const tot = sub + vIva;

        modalContentWrapper.querySelector('#edit-cot-subtotal-display').textContent = formatCurrency(Math.round(sub));
        modalContentWrapper.querySelector('#edit-cot-iva-display').textContent = formatCurrency(vIva);
        modalContentWrapper.querySelector('#edit-cot-total-display').textContent = formatCurrency(Math.round(tot));

        return { subtotal: sub, valorIVA: vIva, total: tot };
    }

    function addEditItemRow(initialItem = null) {
        const r = document.createElement('div');
        r.className = 'edit-item-row bg-slate-50 p-3.5 rounded-xl border border-slate-200 space-y-2.5';
        
        const initVal = initialItem 
            ? (initialItem.referencia && initialItem.descripcion && initialItem.referencia !== initialItem.descripcion ? `${initialItem.referencia} - ${initialItem.descripcion}` : (initialItem.referencia || initialItem.descripcion || ''))
            : '';

        let initCosto = 0;
        if (initialItem?.itemId) {
            const found = allItems.find(i => i.id === initialItem.itemId);
            if (found) initCosto = getItemAverageCost(found);
        } else if (initialItem?.referencia) {
            const found = allItems.find(i => (i.referencia || '').toLowerCase() === (initialItem.referencia || '').toLowerCase());
            if (found) initCosto = getItemAverageCost(found);
        }

        r.innerHTML = `
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div class="relative">
                    <label class="block text-[10px] font-bold text-slate-500 uppercase mb-1">Ítem / Perfil</label>
                    <input type="text" class="edit-item-search w-full p-2.5 bg-white border border-slate-200 rounded-lg text-xs font-semibold" placeholder="Buscar perfil..." value="${initVal}" autocomplete="off" required>
                    <input type="hidden" class="edit-item-id" value="${initialItem?.itemId || ''}">
                    <div class="edit-item-auto search-results hidden"></div>
                    <div class="edit-item-costo-badge mt-1.5 flex items-center gap-1.5 text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 w-fit ${initCosto > 0 ? '' : 'hidden'} cursor-pointer" title="Aplicar como valor unitario">
                        <i class="fa-solid fa-chart-line text-[9px]"></i> Promedio: <span class="edit-item-costo-val">${formatCurrency(initCosto)}</span>
                        <span class="text-[8px] bg-emerald-200/80 px-1 rounded text-emerald-800">Usar</span>
                    </div>
                </div>
                <div class="relative">
                    <label class="block text-[10px] font-bold text-slate-500 uppercase mb-1">Color</label>
                    <input type="text" class="edit-item-color w-full p-2.5 bg-white border border-slate-200 rounded-lg text-xs font-semibold" placeholder="Color..." value="${initialItem?.color || 'Estándar / Por Definir'}" autocomplete="off">
                    <div class="edit-color-auto search-results hidden"></div>
                </div>
            </div>
            <div class="grid grid-cols-4 gap-2 items-center">
                <div>
                    <label class="block text-[10px] font-bold text-slate-500 uppercase mb-1">Cant.</label>
                    <input type="number" min="1" class="edit-item-cant w-full p-2.5 bg-white border border-slate-200 rounded-lg text-xs font-bold text-center" value="${initialItem?.cantidad || 1}" required>
                </div>
                <div>
                    <label class="block text-[10px] font-bold text-slate-500 uppercase mb-1">V. Unitario</label>
                    <input type="text" class="edit-item-unit w-full p-2.5 bg-white border border-slate-200 rounded-lg text-xs font-bold" value="${formatCurrency(initialItem?.valorUnitario || initCosto || 0)}" required>
                </div>
                <div>
                    <label class="block text-[10px] font-bold text-slate-500 uppercase mb-1">Total</label>
                    <div class="edit-item-total p-2.5 bg-slate-200/70 border border-slate-200 rounded-lg text-xs font-bold text-indigo-700 text-right truncate">
                        ${formatCurrency((initialItem?.cantidad || 1) * (initialItem?.valorUnitario || initCosto || 0))}
                    </div>
                </div>
                <div class="text-right pt-4">
                    <button type="button" class="edit-remove-row-btn text-rose-500 hover:text-rose-700 text-xs font-bold px-2 py-1 rounded hover:bg-rose-50 transition">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                </div>
            </div>
        `;

        itemsContainer.appendChild(r);

        const sInput = r.querySelector('.edit-item-search');
        const sId = r.querySelector('.edit-item-id');
        const sAuto = r.querySelector('.edit-item-auto');
        const cInput = r.querySelector('.edit-item-color');
        const cAuto = r.querySelector('.edit-color-auto');
        const cantInput = r.querySelector('.edit-item-cant');
        const unitInput = r.querySelector('.edit-item-unit');
        const removeBtn = r.querySelector('.edit-remove-row-btn');
        const badge = r.querySelector('.edit-item-costo-badge');
        const badgeVal = r.querySelector('.edit-item-costo-val');

        initSearchableInput(
            sInput,
            sAuto,
            () => allItems,
            (it) => `${it.referencia} - ${it.descripcion}`,
            (item) => {
                if (item) {
                    sInput.value = item.referencia && item.descripcion ? `${item.referencia} - ${item.descripcion}` : (item.referencia || item.descripcion || '');
                    sId.value = item.id;
                    const avg = getItemAverageCost(item);
                    if (avg > 0) {
                        badge.classList.remove('hidden');
                        badgeVal.textContent = formatCurrency(avg);
                        const cur = unformatCurrency(unitInput.value);
                        if (!cur || cur === 0) unitInput.value = formatCurrency(avg);
                    } else {
                        badge.classList.add('hidden');
                    }
                    calcEditTotals();
                } else {
                    sId.value = '';
                    badge.classList.add('hidden');
                }
            },
            (it) => {
                const avg = getItemAverageCost(it);
                return `
                    <div class="flex justify-between items-center py-1 gap-2">
                        <div class="font-bold text-slate-800 text-xs truncate">${it.referencia} - ${it.descripcion}</div>
                        <div>${avg > 0 ? `<span class="bg-emerald-50 text-emerald-700 font-bold px-1.5 py-0.5 rounded text-[9px] border border-emerald-200">Prom: ${formatCurrency(avg)}</span>` : ''}</div>
                    </div>
                `;
            }
        );

        badge.addEventListener('click', () => {
            const item = allItems.find(i => i.id === sId.value);
            const avg = item ? getItemAverageCost(item) : unformatCurrency(badgeVal.textContent);
            if (avg > 0) {
                unitInput.value = formatCurrency(avg);
                calcEditTotals();
                showTemporaryMessage("Costo promedio aplicado.", "success");
            }
        });

        initSearchableInput(
            cInput,
            cAuto,
            () => [{ nombre: 'Estándar / Por Definir' }, ...(allColores || [])],
            (col) => col.nombre,
            (selCol) => { if (selCol) cInput.value = selCol.nombre; }
        );

        unitInput.addEventListener('focus', (e) => unformatCurrencyInput(e.target));
        unitInput.addEventListener('blur', (e) => {
            formatCurrencyInput(e.target);
            calcEditTotals();
        });

        cantInput.addEventListener('input', calcEditTotals);

        removeBtn.addEventListener('click', () => {
            if (itemsContainer.children.length > 1) {
                r.remove();
                calcEditTotals();
            } else {
                showTemporaryMessage("La cotización debe tener al menos un ítem.", "info");
            }
        });
    }

    if (Array.isArray(c.items) && c.items.length > 0) {
        c.items.forEach(it => addEditItemRow(it));
    } else {
        addEditItemRow();
    }

    addItemBtn.addEventListener('click', () => addEditItemRow());
    ivaCheckbox.addEventListener('change', calcEditTotals);
    calcEditTotals();

    // Form submit de edición con GUARDADO AUTOMÁTICO DE VERSIONES
    const form = modalContentWrapper.querySelector('#edit-cotizacion-form');
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const submitBtn = modalContentWrapper.querySelector('#edit-cot-submit-btn');
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i>Guardando versión...';

        try {
            const clienteName = editClienteInput.value.trim();
            const clienteIdVal = editClienteId.value;
            const clienteObj = allClientes.find(cli => cli.id === clienteIdVal) || {
                id: null,
                nombre: clienteName,
                nit: c.clienteNit || '',
                email: c.clienteEmail || '',
                telefono1: c.clienteTelefono || ''
            };

            const newItems = [];
            itemsContainer.querySelectorAll('.edit-item-row').forEach(row => {
                const sInput = row.querySelector('.edit-item-search');
                const sId = row.querySelector('.edit-item-id');
                const cInput = row.querySelector('.edit-item-color');
                const cantInput = row.querySelector('.edit-item-cant');
                const unitInput = row.querySelector('.edit-item-unit');

                const cantidad = parseInt(cantInput.value) || 0;
                const valorUnitario = unformatCurrency(unitInput.value);

                if (sInput.value.trim() && cantidad > 0) {
                    const sel = allItems.find(i => i.id === sId.value);
                    let ref = sel ? sel.referencia : '';
                    let desc = sel ? sel.descripcion : '';
                    if (!ref && !desc) {
                        const raw = sInput.value.trim();
                        if (raw.includes(' - ')) {
                            const p = raw.split(' - ');
                            ref = p[0].trim();
                            desc = p.slice(1).join(' - ').trim();
                        } else {
                            ref = raw;
                            desc = raw;
                        }
                    }

                    newItems.push({
                        itemId: sId.value || null,
                        referencia: ref || desc,
                        descripcion: desc || ref,
                        color: (cInput?.value || 'Estándar / Por Definir').trim(),
                        cantidad: cantidad,
                        valorUnitario: valorUnitario,
                        valorTotal: cantidad * valorUnitario
                    });
                }
            });

            if (newItems.length === 0) {
                throw new Error("Debes tener al menos un ítem válido.");
            }

            const { subtotal, valorIVA, total } = calcEditTotals();
            const validezVal = parseInt(modalContentWrapper.querySelector('#edit-cot-validez').value) || 15;
            const obsVal = modalContentWrapper.querySelector('#edit-cot-observaciones').value.trim();
            const incIvaVal = ivaCheckbox.checked;

            showModalMessage("Guardando nueva versión...", true);

            // 1. Guardar snapshot de la versión anterior
            const currentVersionNum = c.version || 1;
            const previousSnapshot = {
                version: currentVersionNum,
                fechaEdicion: new Date().toISOString(),
                fecha: c.fecha || new Date().toISOString().split('T')[0],
                editadoPor: currentUserData?.nombre || currentUser?.displayName || 'Usuario',
                idCliente: c.idCliente || null,
                clienteNombre: c.clienteNombre || '',
                clienteNit: c.clienteNit || '',
                clienteEmail: c.clienteEmail || '',
                clienteTelefono: c.clienteTelefono || '',
                validez: c.validez || 15,
                items: JSON.parse(JSON.stringify(c.items || [])),
                subtotal: c.subtotal || 0,
                incluyeIVA: !!c.incluyeIVA,
                valorIVA: c.valorIVA || 0,
                valorTotal: c.valorTotal || 0,
                observaciones: c.observaciones || ''
            };

            const nuevoHistorial = [...(c.historialVersiones || []), previousSnapshot];
            const nuevaVersionNumero = currentVersionNum + 1;

            const updateData = {
                idCliente: clienteObj.id,
                clienteNombre: clienteObj.nombre,
                clienteNit: clienteObj.nit || clienteObj.cedula || c.clienteNit || '',
                clienteEmail: clienteObj.email || c.clienteEmail || '',
                clienteTelefono: clienteObj.telefono1 || clienteObj.telefono2 || c.clienteTelefono || '',
                validez: validezVal,
                items: newItems,
                subtotal: Math.round(subtotal),
                incluyeIVA: incIvaVal,
                valorIVA: Math.round(valorIVA),
                valorTotal: Math.round(total),
                observaciones: obsVal,
                version: nuevaVersionNumero,
                historialVersiones: nuevoHistorial,
                ultimaEdicionPor: currentUserData?.nombre || currentUser?.displayName || 'Usuario',
                fechaUltimaEdicion: new Date().toISOString(),
                _lastUpdated: serverTimestamp()
            };

            await updateDoc(doc(db, "cotizaciones", c.id), updateData);

            Object.assign(c, updateData);
            updateLocalCache(c);

            closeModal();
            hideModal();
            renderCotizaciones();
            showTemporaryMessage(`¡Cotización N° COT-${c.numeroCotizacion} actualizada a la Versión ${nuevaVersionNumero}!`, "success");

        } catch (err) {
            hideModal();
            showModalMessage("Error al guardar cambios: " + err.message);
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = '<i class="fa-solid fa-floppy-disk mr-2"></i>Guardar Cambios';
            }
        }
    });
}

// --- MODAL DE OPCIONES ADICIONALES ---
function showCotizacionActionsModal(c) {
    const modal = document.getElementById('modal');
    const modalContentWrapper = document.getElementById('modal-content-wrapper');
    if (!modal || !modalContentWrapper) return;

    const versionsCount = (c.historialVersiones || []).length;

    modalContentWrapper.innerHTML = `
        <div class="bg-white rounded-2xl max-w-md w-full mx-auto p-6 shadow-2xl space-y-4">
            <div class="flex justify-between items-center border-b border-slate-100 pb-3">
                <div>
                    <h3 class="font-extrabold text-slate-800 text-base">Opciones - COT-${c.numeroCotizacion}</h3>
                    <p class="text-[11px] text-slate-400">Versión actual: <b class="text-sky-700">v${c.version || 1}</b></p>
                </div>
                <button id="close-actions-modal" class="text-slate-400 hover:text-slate-600 text-xl font-bold">&times;</button>
            </div>

            <div>
                <label class="block text-xs font-bold text-slate-600 uppercase mb-2">Cambiar Estado:</label>
                <div class="grid grid-cols-2 gap-2">
                    <button data-state="Pendiente" class="change-state-btn p-2.5 rounded-xl border text-xs font-bold transition flex items-center justify-center gap-1.5 ${c.estado === 'Pendiente' ? 'bg-amber-100 text-amber-800 border-amber-300' : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200'}">
                        <i class="fa-solid fa-clock text-amber-500"></i> Pendiente
                    </button>
                    <button data-state="Aprobada" class="change-state-btn p-2.5 rounded-xl border text-xs font-bold transition flex items-center justify-center gap-1.5 ${c.estado === 'Aprobada' ? 'bg-emerald-100 text-emerald-800 border-emerald-300' : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200'}">
                        <i class="fa-solid fa-check text-emerald-500"></i> Aprobada
                    </button>
                    <button data-state="Rechazada" class="change-state-btn p-2.5 rounded-xl border text-xs font-bold transition flex items-center justify-center gap-1.5 ${c.estado === 'Rechazada' ? 'bg-rose-100 text-rose-800 border-rose-300' : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200'}">
                        <i class="fa-solid fa-circle-xmark text-rose-500"></i> Rechazada
                    </button>
                    <button id="modal-actions-history-btn" class="p-2.5 rounded-xl border text-xs font-bold transition flex items-center justify-center gap-1.5 bg-sky-50 hover:bg-sky-100 text-sky-800 border-sky-200">
                        <i class="fa-solid fa-clock-rotate-left text-sky-600"></i> Versiones (${versionsCount})
                    </button>
                </div>
            </div>

            <div class="pt-3 border-t border-slate-100 space-y-2">
                <button id="actions-duplicate-btn" class="w-full bg-slate-50 hover:bg-slate-100 text-slate-700 font-bold py-2.5 px-4 rounded-xl text-xs transition border border-slate-200 flex items-center justify-center gap-2">
                    <i class="fa-solid fa-copy text-slate-500"></i> Duplicar Cotización
                </button>
                <button id="actions-archive-toggle-btn" class="w-full ${c.archivada ? 'bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border-indigo-200' : 'bg-amber-50 hover:bg-amber-100 text-amber-800 border-amber-200'} font-bold py-2.5 px-4 rounded-xl text-xs transition border flex items-center justify-center gap-2">
                    <i class="fa-solid fa-box-archive"></i> ${c.archivada ? 'Desarchivar Cotización (Mover a Activas)' : 'Archivar Cotización'}
                </button>
                <button id="cancel-actions-btn" class="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-2 rounded-xl text-xs transition mt-2">
                    Cerrar
                </button>
            </div>
        </div>
    `;

    modal.classList.remove('hidden');

    const closeModal = () => {
        modal.classList.add('hidden');
        modalContentWrapper.innerHTML = '';
    };

    modalContentWrapper.querySelector('#close-actions-modal')?.addEventListener('click', closeModal);
    modalContentWrapper.querySelector('#cancel-actions-btn')?.addEventListener('click', closeModal);

    // Historial de versiones desde opciones
    modalContentWrapper.querySelector('#modal-actions-history-btn')?.addEventListener('click', () => {
        closeModal();
        showCotizacionVersionHistoryModal(c);
    });

    // Duplicar desde opciones
    modalContentWrapper.querySelector('#actions-duplicate-btn')?.addEventListener('click', () => {
        closeModal();
        duplicateCotizacion(c);
    });

    // Archivar / Desarchivar cotización (las cotizaciones no se eliminan, se archivan)
    modalContentWrapper.querySelector('#actions-archive-toggle-btn')?.addEventListener('click', async () => {
        const newArchivedState = !c.archivada;
        try {
            showModalMessage(newArchivedState ? "Archivando cotización..." : "Desarchivando cotización...", true);
            await updateDoc(doc(db, "cotizaciones", c.id), {
                archivada: newArchivedState,
                _lastUpdated: serverTimestamp()
            });
            c.archivada = newArchivedState;
            updateLocalCache(c);
            renderCotizaciones();
            closeModal();
            hideModal();
            showTemporaryMessage(newArchivedState ? "Cotización archivada correctamente." : "Cotización desarchivada y activa.", "info");
        } catch (err) {
            hideModal();
            showModalMessage("Error al cambiar estado de archivo: " + err.message);
        }
    });

    modalContentWrapper.querySelectorAll('.change-state-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const newState = btn.dataset.state;
            try {
                showModalMessage("Actualizando estado...", true);
                await updateDoc(doc(db, "cotizaciones", c.id), {
                    estado: newState,
                    _lastUpdated: serverTimestamp()
                });
                c.estado = newState;
                updateLocalCache(c);
                closeModal();
                hideModal();
                showTemporaryMessage(`Cotización actualizada a ${newState}`, "success");
            } catch (err) {
                hideModal();
                showModalMessage("Error al cambiar estado: " + err.message);
            }
        });
    });

    modalContentWrapper.querySelector('.toggle-archive-btn')?.addEventListener('click', async () => {
        const newArchivedState = !c.archivada;
        try {
            showModalMessage(newArchivedState ? "Archivando..." : "Desarchivando...", true);
            await updateDoc(doc(db, "cotizaciones", c.id), {
                archivada: newArchivedState,
                _lastUpdated: serverTimestamp()
            });
            c.archivada = newArchivedState;
            updateLocalCache(c);
            closeModal();
            hideModal();
            showTemporaryMessage(newArchivedState ? "Cotización archivada." : "Cotización desarchivada.", "info");
        } catch (err) {
            hideModal();
            showModalMessage("Error al archivar cotización: " + err.message);
        }
    });
}

// --- DUPLICAR COTIZACIÓN ---
function duplicateCotizacion(c) {
    const clienteInput = document.getElementById('cotizacion-cliente-input');
    const clienteIdHidden = document.getElementById('cotizacion-cliente-id');
    const validezInput = document.getElementById('cotizacion-validez');
    const observacionesInput = document.getElementById('cotizacion-observaciones');
    const ivaCheckbox = document.getElementById('cotizacion-incluir-iva');

    if (clienteInput) clienteInput.value = c.clienteNombre || '';
    if (clienteIdHidden) clienteIdHidden.value = c.idCliente || '';
    if (validezInput) validezInput.value = c.validez || 15;
    if (observacionesInput) observacionesInput.value = c.observaciones || '';
    if (ivaCheckbox) ivaCheckbox.checked = !!c.incluyeIVA;

    // Limpiar filas de ítems existentes
    const itemsContainer = document.getElementById('cotizacion-items-container');
    if (itemsContainer) {
        itemsContainer.innerHTML = '';
        if (Array.isArray(c.items) && c.items.length > 0) {
            c.items.forEach(item => {
                addCotizacionItemRow(item);
            });
        } else {
            addCotizacionItemRow();
        }
    }

    calcularTotalesCotizacion();

    // Abrir modal de formulario
    const cotFormContainer = document.getElementById('cotizacion-form-container');
    if (cotFormContainer) {
        cotFormContainer.classList.add('show-modal');
    }

    showTemporaryMessage("Datos de la cotización cargados en el formulario de Nueva Cotización.", "info");
}

// --- ESCALAR A REMISIÓN (CONVERSIÓN 1-CLIC) ---
export async function handleEscalarARemision(cotizacionId) {
    const cotizacion = allCotizaciones.find(c => c.id === cotizacionId);
    if (!cotizacion) return showModalMessage("Cotización no encontrada.");

    if (cotizacion.estado === 'Convertida') {
        return showModalMessage(`Esta cotización ya fue escalada a la Remisión N° ${cotizacion.numeroRemision}.`);
    }

    if (!confirm(`¿Deseas ESCALAR la Cotización N° ${cotizacion.numeroCotizacion} a una Remisión Oficial de Producción?\n\nEsta acción descontará el inventario y generará el número de remisión oficial.`)) {
        return;
    }

    showModalMessage("Escalando cotización a remisión oficial...", true);

    try {
        let newRemisionNumber = 0;
        let createdRemisionId = null;

        await runTransaction(db, async (transaction) => {
            // 1. Obtener consecutivo oficial de remisiones
            const counterRef = doc(db, "counters", "remisionCounter");
            const counterDoc = await transaction.get(counterRef);
            
            const currentNum = counterDoc.exists()
                ? (typeof counterDoc.data().currentNumber === 'number' ? counterDoc.data().currentNumber : (typeof counterDoc.data().current === 'number' ? counterDoc.data().current : 0))
                : 0;
            newRemisionNumber = currentNum + 1;

            // 2. Comprobar y descontar stock de los ítems cotizados
            const itemsParaGuardar = [];
            for (const item of (cotizacion.items || [])) {
                if (item.itemId) {
                    const itemRef = doc(db, "items", item.itemId);
                    const itemDoc = await transaction.get(itemRef);
                    if (itemDoc.exists()) {
                        const currentStock = itemDoc.data().stock || 0;
                        const nuevoStock = currentStock - (parseInt(item.cantidad) || 0);
                        transaction.update(itemRef, { 
                            stock: nuevoStock,
                            _lastUpdated: serverTimestamp()
                        });
                    }
                }
                itemsParaGuardar.push({
                    itemId: item.itemId || null,
                    referencia: item.referencia || item.descripcion || '',
                    descripcion: item.descripcion || '',
                    color: item.color || '',
                    cantidad: parseInt(item.cantidad) || 0,
                    valorPorLamina: unformatCurrency(item.valorUnitario || item.valorPorLamina || 0),
                    valorTotal: unformatCurrency(item.valorTotal || (item.cantidad * (item.valorUnitario || 0))),
                    cortes: item.cortes || []
                });
            }

            // 3. Crear Remisión Oficial
            const remisionRef = doc(collection(db, "remisiones"));
            createdRemisionId = remisionRef.id;

            const nuevaRemision = {
                numeroRemision: newRemisionNumber,
                idCliente: cotizacion.idCliente || '',
                clienteNombre: cotizacion.clienteNombre || 'Sin cliente',
                clienteNit: cotizacion.clienteNit || 'N/A',
                clienteEmail: cotizacion.clienteEmail || '',
                clienteTelefono: cotizacion.clienteTelefono || 'N/A',
                fechaRecibido: new Date().toISOString().split('T')[0],
                formaPago: "Pendiente",
                saldoPendiente: Math.round(cotizacion.valorTotal || 0),
                observaciones: `[Generada desde Cotización N° ${cotizacion.numeroCotizacion}]\n${cotizacion.observaciones || ''}`,
                incluyeIVA: !!cotizacion.incluyeIVA,
                items: itemsParaGuardar,
                cargosAdicionales: [],
                subtotal: Math.round(cotizacion.subtotal || 0),
                valorIVA: Math.round(cotizacion.valorIVA || 0),
                valorTotal: Math.round(cotizacion.valorTotal || 0),
                creadoPor: currentUser?.uid || 'sistema',
                cotizacionOrigenId: cotizacion.id,
                numeroCotizacionOrigen: cotizacion.numeroCotizacion,
                timestamp: Date.now(),
                estado: 'Recibido',
                payments: [],
                _lastUpdated: serverTimestamp()
            };

            transaction.set(remisionRef, nuevaRemision);

            // 4. Incrementar contador oficial en Firestore
            transaction.set(counterRef, { currentNumber: newRemisionNumber, current: newRemisionNumber }, { merge: true });

            // 5. Actualizar estado de la cotización a Convertida
            const cotizacionRef = doc(db, "cotizaciones", cotizacion.id);
            transaction.update(cotizacionRef, {
                estado: 'Convertida',
                remisionId: createdRemisionId,
                numeroRemision: newRemisionNumber,
                convertidaEn: Date.now(),
                _lastUpdated: serverTimestamp()
            });
        });

        // Actualizar caché local de la cotización
        cotizacion.estado = 'Convertida';
        cotizacion.remisionId = createdRemisionId;
        cotizacion.numeroRemision = newRemisionNumber;
        updateLocalCache(cotizacion);

        hideModal();
        showModalMessage(`¡Éxito! La cotización fue escalada a la Remisión Oficial N° ${newRemisionNumber}.`, false, 6000);

    } catch (error) {
        hideModal();
        console.error("Error al escalar cotización:", error);
        showModalMessage("Error al escalar a remisión: " + error.message);
    }
}

// --- GESTIÓN DE EVENTOS DEL FORMULARIO Y FILTROS ---
export function setupCotizacionesEvents() {
    const container = document.getElementById('view-cotizaciones');
    if (!container) return;

    // Filtros de Estado
    container.querySelectorAll('.cotizacion-filter-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            currentFilter = e.currentTarget.dataset.filter;
            currentPage = 1;
            renderCotizaciones();
        });
    });

    // Buscador
    const searchInput = document.getElementById('search-cotizaciones');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            searchQuery = e.target.value;
            currentPage = 1;
            renderCotizaciones();
        });
    }

    // Filtros de Fecha
    const monthSelect = document.getElementById('filter-month-cotizaciones');
    const yearSelect = document.getElementById('filter-year-cotizaciones');
    if (monthSelect) {
        populateDateFilters(monthSelect, yearSelect);
        monthSelect.addEventListener('change', () => { currentPage = 1; renderCotizaciones(); });
    }
    if (yearSelect) {
        yearSelect.addEventListener('change', () => { currentPage = 1; renderCotizaciones(); });
    }

    // Botón para abrir modal móvil de creación
    const mobileAddBtn = document.getElementById('mobile-add-cotizacion-btn');
    const formContainer = document.getElementById('cotizacion-form-container');
    if (mobileAddBtn && formContainer) {
        mobileAddBtn.addEventListener('click', () => {
            formContainer.classList.add('show-modal');
        });
    }

    // Botón para cerrar modal móvil de creación
    container.querySelectorAll('.mobile-close-form-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const targetId = e.currentTarget.dataset.target;
            const targetEl = document.getElementById(targetId);
            if (targetEl) targetEl.classList.remove('show-modal');
        });
    });

    // Inicializar autocompletado de Cliente
    const clienteInput = document.getElementById('cotizacion-cliente-input');
    const clienteIdHidden = document.getElementById('cotizacion-cliente-id');
    const clienteList = document.getElementById('cotizacion-cliente-list');
    if (clienteInput && clienteIdHidden && clienteList) {
        initSearchableInput(
            clienteInput,
            clienteList,
            () => allClientes,
            (c) => c.nombreEmpresa ? `${c.nombreEmpresa} (${c.nombre})` : c.nombre,
            (cliente) => {
                if (cliente) {
                    clienteInput.value = cliente.nombreEmpresa ? `${cliente.nombreEmpresa} (${cliente.nombre})` : cliente.nombre;
                    clienteIdHidden.value = cliente.id;
                } else {
                    clienteIdHidden.value = '';
                }
            }
        );
    }

    // Botón Añadir Ítem
    const addItemBtn = document.getElementById('cotizacion-add-item-btn');
    if (addItemBtn) {
        addItemBtn.addEventListener('click', () => addCotizacionItemRow());
    }

    // Checkbox IVA
    const ivaCheckbox = document.getElementById('cotizacion-incluir-iva');
    if (ivaCheckbox) {
        ivaCheckbox.addEventListener('change', calcularTotalesCotizacion);
    }

    // Submit Formulario
    const cotizacionForm = document.getElementById('cotizacion-form');
    if (cotizacionForm) {
        cotizacionForm.addEventListener('submit', handleCotizacionSubmit);
    }

    // Inicializar con 1 fila de ítem vacía si no hay ninguna
    const itemsContainer = document.getElementById('cotizacion-items-container');
    if (itemsContainer && itemsContainer.children.length === 0) {
        addCotizacionItemRow();
    }
}

// --- OBTENER COSTO / PRECIO PROMEDIO DE UN ÍTEM ---
function getItemAverageCost(item) {
    if (!item) return 0;
    return item.precioPromedioVenta || item.costoPromedio || item.precioVenta || item.costo || 0;
}

// --- AÑADIR FILA DE ÍTEM AL FORMULARIO ---
function addCotizacionItemRow(initialData = null) {
    const container = document.getElementById('cotizacion-items-container');
    if (!container) return;

    localElementCounter++;
    const rowId = `cot-item-${localElementCounter}`;
    const row = document.createElement('div');
    row.className = 'cot-item-row bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs space-y-3';
    row.id = rowId;

    const initialItemValue = initialData 
        ? (initialData.referencia && initialData.descripcion && initialData.referencia !== initialData.descripcion 
            ? `${initialData.referencia} - ${initialData.descripcion}` 
            : (initialData.referencia || initialData.descripcion || ''))
        : '';

    let initialItemCosto = 0;
    if (initialData?.itemId) {
        const found = allItems.find(i => i.id === initialData.itemId);
        if (found) initialItemCosto = getItemAverageCost(found);
    } else if (initialData?.referencia) {
        const found = allItems.find(i => (i.referencia || '').toLowerCase() === (initialData.referencia || '').toLowerCase());
        if (found) initialItemCosto = getItemAverageCost(found);
    }

    row.innerHTML = `
        <div class="flex justify-between items-center">
            <span class="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                <i class="fa-solid fa-cube text-indigo-500"></i> Ítem #<span class="item-number"></span>
            </span>
            <button type="button" class="remove-cot-item-btn text-rose-500 hover:text-rose-700 text-xs font-bold px-2 py-1 rounded-lg hover:bg-rose-50 transition">
                <i class="fa-solid fa-trash-can"></i>
            </button>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div class="relative">
                <label class="block text-[11px] font-bold text-slate-500 uppercase mb-1">Buscar Ítem / Perfil</label>
                <input type="text" class="cot-item-search-input w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold text-slate-800" placeholder="Escribe referencia o nombre del perfil..." value="${initialItemValue}" autocomplete="off" required>
                <input type="hidden" class="cot-item-id-hidden" value="${initialData?.itemId || ''}">
                <div class="cot-item-autocomplete-list search-results hidden"></div>
                <div class="cot-item-costo-badge mt-1.5 flex items-center gap-1.5 text-[11px] font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 transition cursor-pointer px-2.5 py-1 rounded-md border border-emerald-200 w-fit ${initialItemCosto > 0 ? '' : 'hidden'}" title="Hacer clic para aplicar como valor unitario">
                    <i class="fa-solid fa-chart-line text-[10px]"></i>
                    <span>Costo Promedio: <span class="cot-item-costo-val">${formatCurrency(initialItemCosto)}</span></span>
                    <span class="text-[9px] font-extrabold text-emerald-800 bg-emerald-200/80 px-1.5 py-0.5 rounded ml-1 shadow-2xs">Usar</span>
                </div>
            </div>

            <div class="relative">
                <label class="block text-[11px] font-bold text-slate-500 uppercase mb-1">Color de Pintura</label>
                <input type="text" class="cot-item-color-input w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold text-slate-800" placeholder="Buscar color o escribir..." value="${initialData?.color || 'Estándar / Por Definir'}" autocomplete="off">
                <div class="cot-item-color-autocomplete search-results hidden"></div>
            </div>
        </div>

        <div class="grid grid-cols-3 gap-3">
            <div>
                <label class="block text-[11px] font-bold text-slate-500 uppercase mb-1">Cantidad</label>
                <input type="number" min="1" class="cot-item-cantidad w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-slate-800" value="${initialData?.cantidad || 1}" required>
            </div>

            <div>
                <label class="block text-[11px] font-bold text-slate-500 uppercase mb-1">V. Unitario</label>
                <input type="text" inputmode="numeric" class="cot-item-valor-unitario w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-slate-800" value="${formatCurrency(initialData?.valorUnitario || initialItemCosto || 0)}" required>
            </div>

            <div>
                <label class="block text-[11px] font-bold text-slate-500 uppercase mb-1">Total Ítem</label>
                <div class="cot-item-total-display p-2.5 bg-slate-100 border border-slate-200 rounded-lg text-xs font-black text-indigo-700 text-right truncate">
                    ${formatCurrency((initialData?.cantidad || 1) * (initialData?.valorUnitario || initialItemCosto || 0))}
                </div>
            </div>
        </div>
    `;

    container.appendChild(row);
    renumberItemRows();

    // Eventos de la fila
    const removeBtn = row.querySelector('.remove-cot-item-btn');
    removeBtn.addEventListener('click', () => {
        if (container.children.length > 1) {
            row.remove();
            renumberItemRows();
            calcularTotalesCotizacion();
        } else {
            showTemporaryMessage("La cotización debe tener al menos un ítem.", "info");
        }
    });

    const searchInput = row.querySelector('.cot-item-search-input');
    const idHidden = row.querySelector('.cot-item-id-hidden');
    const autoList = row.querySelector('.cot-item-autocomplete-list');
    const colorInput = row.querySelector('.cot-item-color-input');
    const colorAutoList = row.querySelector('.cot-item-color-autocomplete');
    const valorUnitarioInput = row.querySelector('.cot-item-valor-unitario');
    const cantidadInput = row.querySelector('.cot-item-cantidad');
    const costoBadge = row.querySelector('.cot-item-costo-badge');
    const costoVal = row.querySelector('.cot-item-costo-val');

    initSearchableInput(
        searchInput,
        autoList,
        () => allItems,
        (it) => `${it.referencia} - ${it.descripcion}`,
        (item) => {
            if (item) {
                searchInput.value = item.referencia && item.descripcion ? `${item.referencia} - ${item.descripcion}` : (item.referencia || item.descripcion || '');
                idHidden.value = item.id;
                
                const avgCost = getItemAverageCost(item);
                if (avgCost > 0) {
                    costoBadge.classList.remove('hidden');
                    costoVal.textContent = formatCurrency(avgCost);
                    
                    const currentVal = unformatCurrency(valorUnitarioInput.value);
                    if (!currentVal || currentVal === 0) {
                        valorUnitarioInput.value = formatCurrency(avgCost);
                    }
                } else {
                    costoBadge.classList.add('hidden');
                }

                updateRowTotal(row);
                calcularTotalesCotizacion();
            } else {
                idHidden.value = '';
                costoBadge.classList.add('hidden');
            }
        },
        (it) => {
            const avgCost = getItemAverageCost(it);
            return `
                <div class="flex justify-between items-center py-1 gap-2">
                    <div class="min-w-0 flex-grow">
                        <div class="font-bold text-slate-800 text-xs truncate">${it.referencia} - ${it.descripcion}</div>
                    </div>
                    <div class="flex-shrink-0">
                        ${avgCost > 0 
                            ? `<span class="bg-emerald-50 text-emerald-700 font-bold px-2 py-0.5 rounded text-[10px] border border-emerald-200 inline-flex items-center gap-1"><i class="fa-solid fa-chart-line text-[9px]"></i> Prom: ${formatCurrency(avgCost)}</span>` 
                            : `<span class="text-slate-400 text-[10px] italic">Sin promedio</span>`
                        }
                    </div>
                </div>
            `;
        }
    );

    // Clic en la insignia de costo promedio para aplicar el valor
    costoBadge.addEventListener('click', () => {
        const item = allItems.find(i => i.id === idHidden.value);
        const avgCost = item ? getItemAverageCost(item) : unformatCurrency(costoVal.textContent);
        if (avgCost > 0) {
            valorUnitarioInput.value = formatCurrency(avgCost);
            updateRowTotal(row);
            calcularTotalesCotizacion();
            showTemporaryMessage("Costo promedio aplicado como valor unitario", "success");
        }
    });

    // Búsqueda manual si escribe o pega la referencia directamente
    searchInput.addEventListener('blur', () => {
        if (!idHidden.value && searchInput.value) {
            const raw = searchInput.value.trim().toLowerCase();
            const matched = allItems.find(i => 
                `${i.referencia} - ${i.descripcion}`.toLowerCase() === raw ||
                (i.referencia && i.referencia.toLowerCase() === raw)
            );
            if (matched) {
                idHidden.value = matched.id;
                const avgCost = getItemAverageCost(matched);
                if (avgCost > 0) {
                    costoBadge.classList.remove('hidden');
                    costoVal.textContent = formatCurrency(avgCost);
                    const currentVal = unformatCurrency(valorUnitarioInput.value);
                    if (!currentVal || currentVal === 0) {
                        valorUnitarioInput.value = formatCurrency(avgCost);
                        updateRowTotal(row);
                        calcularTotalesCotizacion();
                    }
                }
            }
        }
    });

    initSearchableInput(
        colorInput,
        colorAutoList,
        () => [{ nombre: 'Estándar / Por Definir' }, ...(allColores || [])],
        (c) => c.nombre,
        (selectedColor) => {
            if (selectedColor) {
                colorInput.value = selectedColor.nombre;
            }
        }
    );

    valorUnitarioInput.addEventListener('focus', (e) => unformatCurrencyInput(e.target));
    valorUnitarioInput.addEventListener('blur', (e) => {
        formatCurrencyInput(e.target);
        updateRowTotal(row);
        calcularTotalesCotizacion();
    });

    cantidadInput.addEventListener('input', () => {
        updateRowTotal(row);
        calcularTotalesCotizacion();
    });
}

function updateRowTotal(row) {
    const cant = parseInt(row.querySelector('.cot-item-cantidad')?.value) || 0;
    const unitVal = unformatCurrency(row.querySelector('.cot-item-valor-unitario')?.value);
    const totalEl = row.querySelector('.cot-item-total-display');
    if (totalEl) {
        totalEl.textContent = formatCurrency(cant * unitVal);
    }
}

function renumberItemRows() {
    document.querySelectorAll('#cotizacion-items-container .item-number').forEach((span, idx) => {
        span.textContent = idx + 1;
    });
}

function calcularTotalesCotizacion() {
    const ivaCheckbox = document.getElementById('cotizacion-incluir-iva');
    const subtotalEl = document.getElementById('cotizacion-subtotal-display');
    const ivaEl = document.getElementById('cotizacion-iva-display');
    const totalEl = document.getElementById('cotizacion-total-display');
    if (!subtotalEl || !totalEl) return { subtotal: 0, iva: 0, total: 0 };

    let subtotal = 0;
    document.querySelectorAll('#cotizacion-items-container .cot-item-row').forEach(row => {
        const cant = parseInt(row.querySelector('.cot-item-cantidad')?.value) || 0;
        const unitVal = unformatCurrency(row.querySelector('.cot-item-valor-unitario')?.value);
        subtotal += cant * unitVal;
    });

    const incluyeIVA = ivaCheckbox ? ivaCheckbox.checked : false;
    const valorIVA = incluyeIVA ? Math.round(subtotal * 0.19) : 0;
    const total = subtotal + valorIVA;

    subtotalEl.textContent = formatCurrency(Math.round(subtotal));
    if (ivaEl) ivaEl.textContent = formatCurrency(valorIVA);
    totalEl.textContent = formatCurrency(Math.round(total));

    return { subtotal, valorIVA, total };
}

// --- SUBMIT: CREACIÓN DE COTIZACIÓN ---
async function handleCotizacionSubmit(e) {
    e.preventDefault();
    const submitBtn = e.target.querySelector('button[type="submit"]');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i>Guardando...';
    }

    try {
        const clienteInput = document.getElementById('cotizacion-cliente-input');
        const clienteIdHidden = document.getElementById('cotizacion-cliente-id');
        const clienteId = clienteIdHidden?.value;
        const clienteNombre = clienteInput?.value.trim();

        if (!clienteNombre) {
            throw new Error("Por favor selecciona o ingresa el nombre del cliente.");
        }

        const cliente = allClientes.find(c => c.id === clienteId) || {
            id: null,
            nombre: clienteNombre,
            nit: '',
            email: '',
            telefono1: ''
        };

        const items = [];
        document.querySelectorAll('#cotizacion-items-container .cot-item-row').forEach(row => {
            const searchInput = row.querySelector('.cot-item-search-input');
            const idHidden = row.querySelector('.cot-item-id-hidden');
            const colorInput = row.querySelector('.cot-item-color-input');
            const cantidadInput = row.querySelector('.cot-item-cantidad');
            const valorUnitarioInput = row.querySelector('.cot-item-valor-unitario');

            const cantidad = parseInt(cantidadInput.value) || 0;
            const valorUnitario = unformatCurrency(valorUnitarioInput.value);

            if (searchInput.value.trim() && cantidad > 0) {
                const selectedItem = allItems.find(i => i.id === idHidden.value);
                let ref = selectedItem ? selectedItem.referencia : '';
                let desc = selectedItem ? selectedItem.descripcion : '';

                if (!ref && !desc) {
                    const rawVal = searchInput.value.trim();
                    if (rawVal.includes(' - ')) {
                        const parts = rawVal.split(' - ');
                        ref = parts[0].trim();
                        desc = parts.slice(1).join(' - ').trim();
                    } else {
                        ref = rawVal;
                        desc = rawVal;
                    }
                }

                items.push({
                    itemId: idHidden.value || null,
                    referencia: ref || desc,
                    descripcion: desc || ref,
                    color: (colorInput?.value || 'Estándar / Por Definir').trim(),
                    cantidad: cantidad,
                    valorUnitario: valorUnitario,
                    valorTotal: cantidad * valorUnitario
                });
            }
        });

        if (items.length === 0) {
            throw new Error("Debes agregar al menos un ítem válido a la cotización.");
        }

        const { subtotal, valorIVA, total } = calcularTotalesCotizacion();
        const validez = parseInt(document.getElementById('cotizacion-validez')?.value) || 15;
        const observaciones = document.getElementById('cotizacion-observaciones')?.value.trim() || '';
        const incluyeIVA = document.getElementById('cotizacion-incluir-iva')?.checked || false;

        showModalMessage("Generando cotización...", true);

        let newCotizacionNumber = 0;

        await runTransaction(db, async (transaction) => {
            const counterRef = doc(db, "counters", "cotizacionCounter");
            const counterDoc = await transaction.get(counterRef);
            
            if (!counterDoc.exists()) {
                newCotizacionNumber = 1;
                transaction.set(counterRef, { current: 1 });
            } else {
                newCotizacionNumber = (counterDoc.data().current || 0) + 1;
                transaction.update(counterRef, { current: newCotizacionNumber });
            }

            const newCotizacionRef = doc(collection(db, "cotizaciones"));
            const nuevaCotizacion = {
                numeroCotizacion: newCotizacionNumber,
                idCliente: cliente.id,
                clienteNombre: cliente.nombre,
                clienteNit: cliente.nit || cliente.cedula || '',
                clienteEmail: cliente.email || '',
                clienteTelefono: cliente.telefono1 || cliente.telefono2 || '',
                fecha: new Date().toISOString().split('T')[0],
                validez: validez,
                items: items,
                subtotal: Math.round(subtotal),
                incluyeIVA: incluyeIVA,
                valorIVA: Math.round(valorIVA),
                valorTotal: Math.round(total),
                observaciones: observaciones,
                estado: 'Pendiente',
                archivada: false,
                version: 1,
                historialVersiones: [],
                creadoPor: currentUser?.uid || 'sistema',
                creadorNombre: currentUserData?.nombre || currentUser?.displayName || 'Jonny Guerrero',
                timestamp: Date.now(),
                _lastUpdated: serverTimestamp()
            };

            transaction.set(newCotizacionRef, nuevaCotizacion);
        });

        // Resetear formulario
        e.target.reset();
        if (clienteIdHidden) clienteIdHidden.value = '';
        const itemsContainer = document.getElementById('cotizacion-items-container');
        if (itemsContainer) itemsContainer.innerHTML = '';
        addCotizacionItemRow();
        calcularTotalesCotizacion();

        // Cerrar modal de Nueva Cotización
        const cotFormContainer = document.getElementById('cotizacion-form-container');
        if (cotFormContainer) {
            cotFormContainer.classList.remove('show-modal');
            cotFormContainer.classList.remove('active');
        }

        hideModal();
        showTemporaryMessage(`¡Cotización N° COT-${newCotizacionNumber} creada con éxito!`, "success");

    } catch (err) {
        hideModal();
        console.error("Error al crear cotización:", err);
        showModalMessage(err.message || "Error al crear la cotización.");
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fa-solid fa-floppy-disk mr-2"></i>Guardar Cotización';
        }
    }
}
