/* ==========================================================================
   COTIZADOR DE AUDITORÍAS EN PDV
   app.js — Lógica de la aplicación
   --------------------------------------------------------------------------
   Este archivo está dividido en módulos (secciones) claramente separados:
     1. STORAGE      -> lectura/escritura en localStorage (config e historial)
     2. CALCULO      -> toda la lógica de cotización (fórmulas)
     3. VALIDACION   -> validaciones de formulario y de configuración
     4. UI - NAVEGACION
     5. UI - NUEVA COTIZACION (formulario + resultado)
     6. UI - CONFIGURACION (escalas y parámetros)
     7. UI - HISTORIAL
     8. PDF (jsPDF)
     9. INICIALIZACION
   ========================================================================== */

/* ==========================================================================
   1. STORAGE
   ========================================================================== */

const STORAGE_KEYS = {
  CONFIG: 'pdv_cotizador_config_v1',
  HISTORY: 'pdv_cotizador_historial_v1',
  COUNTER: 'pdv_cotizador_contador_v1',
};

/**
 * Valores de ejemplo. NO SON PRECIOS REALES DE MERCADO.
 * El usuario debe editarlos desde "Configuración de costos".
 */
function getDefaultConfig() {
  return {
    // --- Escalas de precio según cantidad de PDV (VALORES DE EJEMPLO) ---
    // "productsIncluidos" = cantidad de productos por PDV que ya están incluidos
    // en el precio base de ESA escala (cada escala puede tener su propio valor).
    scales: [
      { id: cryptoId(), min: 1, max: 10, price: 10000000, productsIncluidos: 50 },
      { id: cryptoId(), min: 11, max: 15, price: 14000000, productsIncluidos: 50 },
      { id: cryptoId(), min: 16, max: 20, price: 18000000, productsIncluidos: 50 },
      { id: cryptoId(), min: 21, max: 30, price: 25000000, productsIncluidos: 50 },
    ],
    // 'cerrado' = precio fijo por escala | 'progresivo' = interpolación entre escalas
    pricingMode: 'cerrado',

    // --- Productos ---
    // Valor de respaldo (fallback) usado únicamente si una escala antigua no
    // tiene su propio "productsIncluidos" configurado (compatibilidad).
    productsIncludedInBase: 50,
    extraProductSurcharge: 5000, // Gs. por cada producto adicional, por PDV, por ciclo

    // --- Zona ---
    surchargeGranAsuncionPercent: 5, // % sobre el subtotal recurrente
    surchargeInteriorPercent: 15, // % sobre el subtotal recurrente

    // --- Auditores ---
    pdvPerAuditor: 5, // capacidad de PDV que cubre 1 auditor (para modo automático)

    // --- Costos operativos ---
    costoTraslado: 150000, // Gs. por auditor, por viaje (ciclo)
    viaticoPorAuditorPorDia: 100000, // Gs.
    alojamientoPorAuditorPorNoche: 180000, // Gs.
    costoVisitaAdicional: 200000, // Gs. por PDV, por visita adicional, por ciclo

    // --- Servicios adicionales (cargo único) ---
    costoEvidenciaFotografica: 300000,
    costoInformeFinal: 500000,
    costoDashboard: 800000,
    costoPresentacion: 400000,

    // --- Comerciales ---
    margenComercialPercent: 20,
    ivaPercent: 10,
    descuentoMaximoPercent: 15,

    moneda: 'PYG',
  };
}

function cryptoId() {
  return 'id_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function getConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.CONFIG);
    if (!raw) {
      const def = getDefaultConfig();
      saveConfig(def);
      return def;
    }
    return JSON.parse(raw);
  } catch (e) {
    console.error('Error leyendo configuración, restaurando valores de ejemplo.', e);
    const def = getDefaultConfig();
    saveConfig(def);
    return def;
  }
}

function saveConfig(config) {
  localStorage.setItem(STORAGE_KEYS.CONFIG, JSON.stringify(config));
}

function getHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.HISTORY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error('Error leyendo historial.', e);
    return [];
  }
}

function saveHistory(list) {
  localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(list));
}

function getNextQuoteNumber() {
  const year = new Date().getFullYear();
  let counterData = {};
  try {
    counterData = JSON.parse(localStorage.getItem(STORAGE_KEYS.COUNTER)) || {};
  } catch (e) {
    counterData = {};
  }
  const current = (counterData[year] || 0) + 1;
  counterData[year] = current;
  localStorage.setItem(STORAGE_KEYS.COUNTER, JSON.stringify(counterData));
  return `COT-${year}-${String(current).padStart(3, '0')}`;
}

/* ==========================================================================
   2. CALCULO
   ========================================================================== */

/**
 * Devuelve la cantidad de "ciclos" de servicio según frecuencia y duración.
 * única      -> 1 ciclo total
 * semanal    -> ~4.33 ciclos por mes
 * quincenal  -> 2 ciclos por mes
 * mensual    -> 1 ciclo por mes
 */
function calcularCiclos(frecuencia, duracionMeses) {
  const meses = Math.max(1, Number(duracionMeses) || 1);
  switch (frecuencia) {
    case 'unica':
      return 1;
    case 'semanal':
      return Math.max(1, Math.round(meses * 4.33));
    case 'quincenal':
      return Math.max(1, Math.round(meses * 2));
    case 'mensual':
      return Math.max(1, meses);
    default:
      return 1;
  }
}

/**
 * Ordena las escalas por "min" ascendente (no muta el arreglo original).
 */
function escalasOrdenadas(scales) {
  return [...scales].sort((a, b) => a.min - b.min);
}

/**
 * Devuelve la cantidad de productos incluidos configurada para una escala.
 * Si la escala no tiene el campo (configuraciones antiguas), usa el valor
 * de respaldo general de la configuración.
 */
function productosIncluidosDeEscala(scale, config) {
  if (scale && scale.productsIncluidos !== undefined && scale.productsIncluidos !== null && scale.productsIncluidos !== '') {
    return Number(scale.productsIncluidos) || 0;
  }
  return Number(config.productsIncludedInBase) || 0;
}

/**
 * Busca el precio base para una cantidad de PDV dada, según el modo de precio.
 * Retorna { price, scaleIndex, isCustom, scale, productsIncluidos }
 */
function obtenerPrecioBasePorPDV(pdvCount, config) {
  const scales = escalasOrdenadas(config.scales);
  if (scales.length === 0) {
    return { price: 0, scaleIndex: -1, isCustom: true, scale: null, productsIncluidos: Number(config.productsIncludedInBase) || 0 };
  }

  const maxScale = scales[scales.length - 1];

  // Si supera la escala máxima -> cotización personalizada (se calcula un estimado)
  if (pdvCount > maxScale.max) {
    const pricePerPdv = maxScale.price / maxScale.max;
    return {
      price: pricePerPdv * pdvCount,
      scaleIndex: scales.length - 1,
      isCustom: true,
      scale: maxScale,
      productsIncluidos: productosIncluidosDeEscala(maxScale, config),
    };
  }

  // Buscar la escala donde entra la cantidad de PDV
  const idx = scales.findIndex((s) => pdvCount >= s.min && pdvCount <= s.max);

  if (idx === -1) {
    // Cae en un hueco entre escalas (no debería pasar si están bien configuradas).
    // Se toma la escala más cercana por arriba como referencia.
    const next = scales.find((s) => s.min > pdvCount);
    const fallback = next || maxScale;
    return {
      price: fallback.price,
      scaleIndex: scales.indexOf(fallback),
      isCustom: true,
      scale: fallback,
      productsIncluidos: productosIncluidosDeEscala(fallback, config),
    };
  }

  const scale = scales[idx];
  const productsIncluidos = productosIncluidosDeEscala(scale, config);

  if (config.pricingMode === 'cerrado' || idx === 0) {
    // Precio cerrado por escala (o primera escala, que no tiene referencia anterior)
    return { price: scale.price, scaleIndex: idx, isCustom: false, scale, productsIncluidos };
  }

  // Modo progresivo: interpolar entre el máximo de la escala anterior y el máximo de esta escala
  const prev = scales[idx - 1];
  const prevMax = prev.max;
  const prevPrice = prev.price;
  const ratio = (pdvCount - prevMax) / (scale.max - prevMax);
  const interpolatedPrice = prevPrice + ratio * (scale.price - prevPrice);

  return { price: interpolatedPrice, scaleIndex: idx, isCustom: false, scale, productsIncluidos };
}

/**
 * Calcula la cotización completa. Recibe los datos del formulario (inputs)
 * y la configuración de costos (config). Devuelve un objeto con todo el
 * desglose necesario para mostrar el resultado y generar el PDF.
 */
function calcularCotizacion(inputs, config) {
  const pdv = Number(inputs.pdvCount) || 0;
  const productosPorPdv = Number(inputs.productsPerPdv) || 0;
  const visitasPorPdv = Number(inputs.visitsPerPdv) || 1;
  const duracionMeses = Number(inputs.durationMonths) || 1;
  const ciclos = calcularCiclos(inputs.frequency, duracionMeses);

  // --- 1. Precio base ---
  const baseInfo = obtenerPrecioBasePorPDV(pdv, config);
  const precioBaseCiclo = baseInfo.price;

  // --- 2. Recargo por productos adicionales (por ciclo) ---
  // La cantidad de productos incluidos depende de la escala de PDV que corresponda.
  const productosIncluidos = Number(baseInfo.productsIncluidos) || 0;
  const productosExtra = Math.max(0, productosPorPdv - productosIncluidos);
  const recargoProductosCiclo = productosExtra * (Number(config.extraProductSurcharge) || 0) * pdv;

  // --- 3. Recargo por visitas adicionales (por ciclo). Se asume 1 visita incluida. ---
  const visitasExtra = Math.max(0, visitasPorPdv - 1);
  const recargoVisitasCiclo = visitasExtra * (Number(config.costoVisitaAdicional) || 0) * pdv;

  const subtotalPorCiclo = precioBaseCiclo + recargoProductosCiclo + recargoVisitasCiclo;
  const subtotalRecurrente = subtotalPorCiclo * ciclos;

  // --- 4. Recargo por zona (sobre el subtotal recurrente) ---
  let porcentajeZona = 0;
  if (inputs.zone === 'granAsuncion') porcentajeZona = Number(config.surchargeGranAsuncionPercent) || 0;
  if (inputs.zone === 'interior') porcentajeZona = Number(config.surchargeInteriorPercent) || 0;
  const recargoZona = subtotalRecurrente * (porcentajeZona / 100);

  // --- 5. Auditores ---
  let cantidadAuditores;
  if (inputs.auditorsMode === 'manual') {
    cantidadAuditores = Math.max(1, Number(inputs.auditorsCount) || 1);
  } else {
    const capacidad = Number(config.pdvPerAuditor) || 1;
    cantidadAuditores = Math.max(1, Math.ceil(pdv / capacidad));
  }

  // --- 6. Costos operativos (traslado, viáticos, alojamiento) ---
  const costoTraslado = inputs.requiresTraslado
    ? cantidadAuditores * ciclos * (Number(config.costoTraslado) || 0)
    : 0;
  const costoViaticos = inputs.requiresViaticos
    ? cantidadAuditores * ciclos * (Number(config.viaticoPorAuditorPorDia) || 0)
    : 0;
  const costoAlojamiento = inputs.requiresAlojamiento
    ? cantidadAuditores * ciclos * (Number(config.alojamientoPorAuditorPorNoche) || 0)
    : 0;

  // --- 7. Servicios adicionales (cargo único) ---
  const costoFotografia = inputs.requiresFotografia ? Number(config.costoEvidenciaFotografica) || 0 : 0;
  const costoInforme = inputs.requiresInforme ? Number(config.costoInformeFinal) || 0 : 0;
  const costoDashboard = inputs.requiresDashboard ? Number(config.costoDashboard) || 0 : 0;
  const costoPresentacion = inputs.requiresPresentacion ? Number(config.costoPresentacion) || 0 : 0;

  // --- 8. Costo adicional manual ---
  const costoAdicionalManual = Number(inputs.extraCostManual) || 0;

  const subtotalOperativo =
    costoTraslado + costoViaticos + costoAlojamiento +
    costoFotografia + costoInforme + costoDashboard + costoPresentacion +
    costoAdicionalManual;

  const subtotalAntesMargen = subtotalRecurrente + recargoZona + subtotalOperativo;

  // --- 9. Margen comercial ---
  const margenPercent = Number(config.margenComercialPercent) || 0;
  const margenComercial = subtotalAntesMargen * (margenPercent / 100);
  const subtotalConMargen = subtotalAntesMargen + margenComercial;

  // --- 10. Descuento ---
  const descuentoMax = Number(config.descuentoMaximoPercent) || 0;
  let descuentoPercent = Number(inputs.discountPercent) || 0;
  if (descuentoPercent > descuentoMax) descuentoPercent = descuentoMax;
  if (descuentoPercent < 0) descuentoPercent = 0;
  const montoDescuento = subtotalConMargen * (descuentoPercent / 100);
  const subtotalConDescuento = subtotalConMargen - montoDescuento;

  // --- 11. IVA ---
  const ivaPercent = Number(config.ivaPercent) || 0;
  const montoIva = subtotalConDescuento * (ivaPercent / 100);

  // --- 12. Total ---
  const total = subtotalConDescuento + montoIva;

  const totalVisitas = visitasPorPdv * ciclos * pdv;
  const costoPromedioPorPdv = pdv > 0 ? total / pdv : 0;
  const costoPromedioPorVisita = totalVisitas > 0 ? total / totalVisitas : 0;

  return {
    inputs,
    ciclos,
    isCustom: baseInfo.isCustom,
    desglose: {
      precioBaseCiclo,
      recargoProductosCiclo,
      recargoVisitasCiclo,
      subtotalPorCiclo,
      subtotalRecurrente,
      porcentajeZona,
      recargoZona,
      cantidadAuditores,
      costoTraslado,
      costoViaticos,
      costoAlojamiento,
      costoFotografia,
      costoInforme,
      costoDashboard,
      costoPresentacion,
      costoAdicionalManual,
      subtotalOperativo,
      subtotalAntesMargen,
      margenPercent,
      margenComercial,
      subtotalConMargen,
      descuentoPercent,
      montoDescuento,
      subtotalConDescuento,
      ivaPercent,
      montoIva,
      total,
    },
    totalProductos: productosPorPdv * pdv,
    totalVisitas,
    productosIncluidosEscala: productosIncluidos,
    costoPromedioPorPdv,
    costoPromedioPorVisita,
  };
}

/* ==========================================================================
   3. VALIDACION
   ========================================================================== */

function formatearMoneda(valor, moneda = 'PYG') {
  const num = Math.round(Number(valor) || 0);
  const formateado = num.toLocaleString('es-PY');
  const prefijo = moneda === 'PYG' ? 'Gs. ' : moneda + ' ';
  return prefijo + formateado;
}

/**
 * Utilidades para mostrar montos en los campos de entrada con separador
 * de miles (formato paraguayo: 10.000.000) mientras se escriben, guardando
 * siempre el valor numérico real "sin puntos" para los cálculos.
 */
function formatMilesDisplay(value) {
  const digits = String(value === undefined || value === null ? '' : value).replace(/[^0-9]/g, '');
  if (digits === '') return '';
  return Number(digits).toLocaleString('es-PY');
}

function parseMilesValue(value) {
  const digits = String(value === undefined || value === null ? '' : value).replace(/[^0-9]/g, '');
  return digits ? Number(digits) : 0;
}

function attachMilesFormatting(el) {
  if (!el) return;
  el.setAttribute('inputmode', 'numeric');
  el.value = formatMilesDisplay(el.value);
  el.addEventListener('input', () => {
    el.value = formatMilesDisplay(el.value);
  });
}

// Campos de configuración que representan montos en guaraníes (se muestran
// con separador de miles). El resto (porcentajes, cantidades) se dejan como
// número simple.
const CAMPOS_MONEDA_CONFIG = [
  'extraProductSurcharge', 'costoTraslado', 'viaticoPorAuditorPorDia',
  'alojamientoPorAuditorPorNoche', 'costoVisitaAdicional', 'costoEvidenciaFotografica',
  'costoInformeFinal', 'costoDashboard', 'costoPresentacion',
];

function validarFormularioCotizacion(inputs) {
  const errores = [];

  if (!inputs.clientName || inputs.clientName.trim() === '') {
    errores.push('El nombre del cliente o empresa es obligatorio.');
  }
  if (!inputs.quoteDate) {
    errores.push('La fecha de cotización es obligatoria.');
  }
  if (!inputs.pdvCount || Number(inputs.pdvCount) <= 0) {
    errores.push('La cantidad de puntos de venta (PDV) debe ser mayor que cero.');
  }
  if (inputs.productsPerPdv === '' || Number(inputs.productsPerPdv) < 0) {
    errores.push('La cantidad de productos por PDV no es válida.');
  }
  if (!inputs.visitsPerPdv || Number(inputs.visitsPerPdv) <= 0) {
    errores.push('La cantidad de visitas por PDV debe ser mayor que cero.');
  }
  if (!inputs.durationMonths || Number(inputs.durationMonths) <= 0) {
    errores.push('La duración del proyecto debe ser mayor que cero.');
  }
  if (!inputs.zone) {
    errores.push('Debe seleccionar una zona.');
  }
  if (inputs.zone === 'interior' && (!inputs.department || inputs.department.trim() === '')) {
    errores.push('Debe indicar el departamento o ciudad para la zona Interior.');
  }
  if (inputs.auditorsMode === 'manual' && (!inputs.auditorsCount || Number(inputs.auditorsCount) <= 0)) {
    errores.push('Debe indicar una cantidad de auditores válida en modo manual.');
  }
  if (Number(inputs.discountPercent) < 0) {
    errores.push('El descuento no puede ser negativo.');
  }
  if (Number(inputs.extraCostManual) < 0) {
    errores.push('El costo adicional manual no puede ser negativo.');
  }
  if (Number(inputs.extraCostManual) > 0 && (!inputs.extraCostReason || inputs.extraCostReason.trim() === '')) {
    errores.push('Debe indicar el motivo del costo adicional manual.');
  }

  return errores;
}

/**
 * Valida que las escalas de configuración no se superpongan y no dejen huecos.
 * Devuelve { errores: [], advertencias: [] }
 */
function validarEscalas(scales) {
  const errores = [];
  const advertencias = [];
  const ordenadas = escalasOrdenadas(scales);

  ordenadas.forEach((s) => {
    if (Number(s.min) <= 0 || Number(s.max) <= 0) {
      errores.push(`La escala ${s.min}-${s.max} debe tener valores mayores que cero.`);
    }
    if (Number(s.min) > Number(s.max)) {
      errores.push(`La escala ${s.min}-${s.max} tiene un mínimo mayor que el máximo.`);
    }
    if (Number(s.price) < 0) {
      errores.push(`La escala ${s.min}-${s.max} tiene un precio negativo.`);
    }
  });

  for (let i = 0; i < ordenadas.length - 1; i++) {
    const actual = ordenadas[i];
    const siguiente = ordenadas[i + 1];
    if (siguiente.min <= actual.max) {
      errores.push(`Las escalas "${actual.min}-${actual.max}" y "${siguiente.min}-${siguiente.max}" se superponen.`);
    } else if (siguiente.min > actual.max + 1) {
      advertencias.push(`Existe un hueco sin cubrir entre ${actual.max} y ${siguiente.min} PDV.`);
    }
  }

  return { errores, advertencias };
}

/* ==========================================================================
   4. UI - NAVEGACION
   ========================================================================== */

const APP_STATE = {
  currentView: 'nueva',
  editingQuoteId: null, // si estamos editando una cotización del historial
  lastResult: null, // último resultado calculado (para exportar / guardar)
};

function initNavegacion() {
  document.querySelectorAll('.nav-link').forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const view = link.getAttribute('data-view');
      cambiarVista(view);
    });
  });

  document.getElementById('menuToggle').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
  });
}

function cambiarVista(view) {
  APP_STATE.currentView = view;
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  document.getElementById('view-' + view).classList.add('active');

  document.querySelectorAll('.nav-link').forEach((l) => l.classList.remove('active'));
  document.querySelector(`.nav-link[data-view="${view}"]`).classList.add('active');

  document.getElementById('sidebar').classList.remove('open');

  if (view === 'historial') renderHistorial();
  if (view === 'config') renderConfiguracion();
}

/* ==========================================================================
   5. UI - NUEVA COTIZACION
   ========================================================================== */

function initFormularioCotizacion() {
  document.getElementById('quoteDate').valueAsDate = new Date();

  document.getElementById('zone').addEventListener('change', (e) => {
    const showDept = e.target.value === 'interior' || e.target.value === 'granAsuncion';
    document.getElementById('departmentWrapper').style.display = showDept ? 'block' : 'none';
  });

  document.getElementById('auditorsMode').addEventListener('change', (e) => {
    document.getElementById('auditorsCountWrapper').style.display =
      e.target.value === 'manual' ? 'block' : 'none';
  });

  attachMilesFormatting(document.getElementById('extraCostManual'));

  document.getElementById('formCotizacion').addEventListener('submit', (e) => {
    e.preventDefault();
    procesarCotizacion();
  });

  document.getElementById('btnLimpiarForm').addEventListener('click', () => {
    if (confirm('¿Limpiar todos los campos del formulario?')) {
      document.getElementById('formCotizacion').reset();
      document.getElementById('quoteDate').valueAsDate = new Date();
      document.getElementById('resultadoWrapper').innerHTML = '';
      attachMilesFormatting(document.getElementById('extraCostManual'));
      APP_STATE.editingQuoteId = null;
      APP_STATE.lastResult = null;
    }
  });
}

function leerInputsFormulario() {
  const f = document.getElementById('formCotizacion');
  return {
    clientName: f.clientName.value,
    contactName: f.contactName.value,
    quoteDate: f.quoteDate.value,
    projectName: f.projectName.value,
    validity: f.validity.value,
    notes: f.notes.value,

    serviceType: f.serviceType.value,
    pdvCount: f.pdvCount.value,
    productsPerPdv: f.productsPerPdv.value,
    visitsPerPdv: f.visitsPerPdv.value,
    frequency: f.frequency.value,
    durationMonths: f.durationMonths.value,
    zone: f.zone.value,
    department: f.department.value,
    auditorsMode: f.auditorsMode.value,
    auditorsCount: f.auditorsCount.value,

    requiresTraslado: f.requiresTraslado.checked,
    requiresAlojamiento: f.requiresAlojamiento.checked,
    requiresViaticos: f.requiresViaticos.checked,
    requiresFotografia: f.requiresFotografia.checked,
    requiresInforme: f.requiresInforme.checked,
    requiresDashboard: f.requiresDashboard.checked,
    requiresPresentacion: f.requiresPresentacion.checked,

    discountPercent: f.discountPercent.value || 0,
    extraCostManual: parseMilesValue(f.extraCostManual.value),
    extraCostReason: f.extraCostReason.value,
  };
}

function procesarCotizacion() {
  const inputs = leerInputsFormulario();
  const errores = validarFormularioCotizacion(inputs);
  const errorBox = document.getElementById('formErrors');

  if (errores.length > 0) {
    errorBox.innerHTML = '<strong>Corrija los siguientes errores:</strong><ul>' +
      errores.map((e) => `<li>${e}</li>`).join('') + '</ul>';
    errorBox.style.display = 'block';
    errorBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  errorBox.style.display = 'none';
  errorBox.innerHTML = '';

  const config = getConfig();
  const resultado = calcularCotizacion(inputs, config);
  APP_STATE.lastResult = resultado;
  renderResultado(resultado, config);
}

function renderResultado(resultado, config) {
  const { inputs, desglose, isCustom, ciclos, totalProductos, totalVisitas, costoPromedioPorPdv, costoPromedioPorVisita } = resultado;
  const wrapper = document.getElementById('resultadoWrapper');

  const numeroCotizacion = APP_STATE.editingQuoteId
    ? (getHistory().find((q) => q.id === APP_STATE.editingQuoteId)?.numero || getNextQuoteNumber())
    : getNextQuoteNumberPreview();

  const serviciosAdicionales = [];
  if (inputs.requiresTraslado) serviciosAdicionales.push('Traslado');
  if (inputs.requiresAlojamiento) serviciosAdicionales.push('Alojamiento');
  if (inputs.requiresViaticos) serviciosAdicionales.push('Viáticos');
  if (inputs.requiresFotografia) serviciosAdicionales.push('Evidencia fotográfica');
  if (inputs.requiresInforme) serviciosAdicionales.push('Informe final');
  if (inputs.requiresDashboard) serviciosAdicionales.push('Dashboard de resultados');
  if (inputs.requiresPresentacion) serviciosAdicionales.push('Presentación de resultados');

  const zonaLabel = { asuncion: 'Asunción', granAsuncion: 'Gran Asunción', interior: 'Interior' }[inputs.zone] || inputs.zone;
  const frecuenciaLabel = { unica: 'Única', semanal: 'Semanal', quincenal: 'Quincenal', mensual: 'Mensual' }[inputs.frequency] || inputs.frequency;

  wrapper.innerHTML = `
    <div class="card result-card">
      <div class="result-header">
        <div>
          <h2>Cotización ${numeroCotizacion}</h2>
          <p class="muted">${inputs.clientName} · ${inputs.projectName || 'Sin nombre de proyecto'}</p>
        </div>
        <div class="total-badge">
          <span class="total-label">Total estimado</span>
          <span class="total-value">${formatearMoneda(desglose.total, config.moneda)}</span>
        </div>
      </div>

      ${isCustom ? `<div class="alert alert-warning">Este servicio requiere una cotización personalizada. El cálculo mostrado es <strong>estimado y está sujeto a revisión</strong>.</div>` : ''}

      <div class="result-grid">
        <div class="result-block">
          <h3>Datos del cliente</h3>
          <dl>
            <dt>Cliente</dt><dd>${inputs.clientName}</dd>
            <dt>Contacto</dt><dd>${inputs.contactName || '-'}</dd>
            <dt>Fecha</dt><dd>${inputs.quoteDate}</dd>
            <dt>Vigencia</dt><dd>${inputs.validity ? inputs.validity + ' días' : '-'}</dd>
          </dl>
        </div>
        <div class="result-block">
          <h3>Alcance del servicio</h3>
          <dl>
            <dt>PDV</dt><dd>${inputs.pdvCount}</dd>
            <dt>Productos por PDV</dt><dd>${inputs.productsPerPdv}</dd>
            <dt>Total productos a auditar</dt><dd>${totalProductos.toLocaleString('es-PY')}</dd>
            <dt>Zona</dt><dd>${zonaLabel}${inputs.department ? ' - ' + inputs.department : ''}</dd>
            <dt>Frecuencia</dt><dd>${frecuenciaLabel}</dd>
            <dt>Duración</dt><dd>${inputs.durationMonths} mes(es) · ${ciclos} ciclo(s) de visita</dd>
            <dt>Visitas totales</dt><dd>${totalVisitas}</dd>
            <dt>Auditores requeridos</dt><dd>${desglose.cantidadAuditores}</dd>
          </dl>
        </div>
      </div>

      ${serviciosAdicionales.length ? `<div class="result-block"><h3>Servicios adicionales</h3><p>${serviciosAdicionales.join(', ')}</p></div>` : ''}

      <div class="result-block">
        <h3>Desglose del cálculo (uso interno)</h3>
        <table class="breakdown-table">
          <tbody>
            <tr><td>Precio base por ciclo</td><td>${formatearMoneda(desglose.precioBaseCiclo, config.moneda)}</td></tr>
            <tr><td>Recargo por productos adicionales (por ciclo)</td><td>${formatearMoneda(desglose.recargoProductosCiclo, config.moneda)}</td></tr>
            <tr><td>Recargo por visitas adicionales (por ciclo)</td><td>${formatearMoneda(desglose.recargoVisitasCiclo, config.moneda)}</td></tr>
            <tr><td>Subtotal por ciclo</td><td>${formatearMoneda(desglose.subtotalPorCiclo, config.moneda)}</td></tr>
            <tr><td>Subtotal recurrente (× ${ciclos} ciclos)</td><td>${formatearMoneda(desglose.subtotalRecurrente, config.moneda)}</td></tr>
            <tr><td>Recargo de zona (${desglose.porcentajeZona}%)</td><td>${formatearMoneda(desglose.recargoZona, config.moneda)}</td></tr>
            <tr><td>Traslado</td><td>${formatearMoneda(desglose.costoTraslado, config.moneda)}</td></tr>
            <tr><td>Viáticos</td><td>${formatearMoneda(desglose.costoViaticos, config.moneda)}</td></tr>
            <tr><td>Alojamiento</td><td>${formatearMoneda(desglose.costoAlojamiento, config.moneda)}</td></tr>
            <tr><td>Evidencia fotográfica</td><td>${formatearMoneda(desglose.costoFotografia, config.moneda)}</td></tr>
            <tr><td>Informe final</td><td>${formatearMoneda(desglose.costoInforme, config.moneda)}</td></tr>
            <tr><td>Dashboard</td><td>${formatearMoneda(desglose.costoDashboard, config.moneda)}</td></tr>
            <tr><td>Presentación de resultados</td><td>${formatearMoneda(desglose.costoPresentacion, config.moneda)}</td></tr>
            <tr><td>Costo adicional manual ${inputs.extraCostReason ? '(' + inputs.extraCostReason + ')' : ''}</td><td>${formatearMoneda(desglose.costoAdicionalManual, config.moneda)}</td></tr>
            <tr class="subtotal-row"><td>Subtotal antes de margen</td><td>${formatearMoneda(desglose.subtotalAntesMargen, config.moneda)}</td></tr>
            <tr><td>Margen de ganancia (${desglose.margenPercent}%)</td><td>${formatearMoneda(desglose.margenComercial, config.moneda)}</td></tr>
            <tr class="subtotal-row"><td>Subtotal con margen</td><td>${formatearMoneda(desglose.subtotalConMargen, config.moneda)}</td></tr>
            <tr class="discount-row"><td>Descuento (${desglose.descuentoPercent}%)</td><td>- ${formatearMoneda(desglose.montoDescuento, config.moneda)}</td></tr>
            <tr class="subtotal-row"><td>Subtotal</td><td>${formatearMoneda(desglose.subtotalConDescuento, config.moneda)}</td></tr>
            <tr><td>IVA (${desglose.ivaPercent}%)</td><td>${formatearMoneda(desglose.montoIva, config.moneda)}</td></tr>
            <tr class="total-row"><td>TOTAL ESTIMADO</td><td>${formatearMoneda(desglose.total, config.moneda)}</td></tr>
          </tbody>
        </table>
      </div>

      <div class="result-grid">
        <div class="stat-card"><span class="stat-label">Costo promedio por PDV</span><span class="stat-value">${formatearMoneda(costoPromedioPorPdv, config.moneda)}</span></div>
        <div class="stat-card"><span class="stat-label">Costo promedio por visita</span><span class="stat-value">${formatearMoneda(costoPromedioPorVisita, config.moneda)}</span></div>
        <div class="stat-card stat-card-margin"><span class="stat-label">Margen de ganancia (${desglose.margenPercent}%)</span><span class="stat-value">${formatearMoneda(desglose.margenComercial, config.moneda)}</span></div>
      </div>

      <div class="alert alert-info">
        Cotización estimativa y sujeta a validación comercial y operativa. El precio final puede variar según el alcance definitivo, ubicación de los puntos de venta y requerimientos adicionales del cliente.
      </div>

      ${inputs.notes ? `<div class="result-block"><h3>Observaciones</h3><p>${inputs.notes}</p></div>` : ''}

      <div class="button-row">
        <button class="btn btn-secondary" id="btnVistaPrevia">Vista previa</button>
        <button class="btn btn-secondary" id="btnImprimir">Imprimir</button>
        <button class="btn btn-secondary" id="btnPdfCliente">Descargar PDF (cliente)</button>
        <button class="btn btn-secondary" id="btnPdfInterno">Descargar PDF (interno)</button>
        <button class="btn btn-primary" id="btnGuardarCotizacion">Guardar en historial</button>
      </div>
    </div>
  `;

  document.getElementById('btnVistaPrevia').addEventListener('click', () => mostrarVistaPrevia(resultado, config, numeroCotizacion));
  document.getElementById('btnImprimir').addEventListener('click', () => window.print());
  document.getElementById('btnPdfCliente').addEventListener('click', () => generarPdf(resultado, config, numeroCotizacion, 'cliente'));
  document.getElementById('btnPdfInterno').addEventListener('click', () => generarPdf(resultado, config, numeroCotizacion, 'interno'));
  document.getElementById('btnGuardarCotizacion').addEventListener('click', () => guardarCotizacionEnHistorial(resultado, numeroCotizacion));

  wrapper.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Vista previa (numeración provisoria, sin consumir el contador real) hasta que se guarde.
function getNextQuoteNumberPreview() {
  const year = new Date().getFullYear();
  let counterData = {};
  try {
    counterData = JSON.parse(localStorage.getItem(STORAGE_KEYS.COUNTER)) || {};
  } catch (e) {
    counterData = {};
  }
  const current = (counterData[year] || 0) + 1;
  return `COT-${year}-${String(current).padStart(3, '0')} (provisorio)`;
}

function guardarCotizacionEnHistorial(resultado, numeroPreview) {
  const historial = getHistory();
  const { inputs, desglose } = resultado;

  let numero;
  let existing = null;
  if (APP_STATE.editingQuoteId) {
    existing = historial.find((q) => q.id === APP_STATE.editingQuoteId);
  }

  if (existing) {
    numero = existing.numero;
  } else {
    numero = getNextQuoteNumber();
  }

  const record = {
    id: existing ? existing.id : cryptoId(),
    numero,
    cliente: inputs.clientName,
    fecha: inputs.quoteDate,
    servicio: inputs.serviceType,
    pdv: inputs.pdvCount,
    zona: inputs.zone,
    total: desglose.total,
    estado: existing ? existing.estado : 'Borrador',
    resultado, // se guarda el objeto completo para poder ver/editar/duplicar/generar PDF luego
  };

  if (existing) {
    const idx = historial.findIndex((q) => q.id === existing.id);
    historial[idx] = record;
  } else {
    historial.push(record);
  }

  saveHistory(historial);
  APP_STATE.editingQuoteId = record.id;
  alert(`Cotización ${numero} guardada correctamente en el historial.`);
}

/* ==========================================================================
   5B. UI - CALCULO RAPIDO
   --------------------------------------------------------------------------
   Vista simplificada para estimar un precio en el momento (ej. durante una
   reunión con el cliente), sin completar todo el formulario de cotización.
   ========================================================================== */

function initCalculoRapido() {
  document.getElementById('btnCalcularRapido').addEventListener('click', procesarCalculoRapido);

  document.getElementById('rapidoZone').addEventListener('change', (e) => {
    const showDept = e.target.value === 'interior' || e.target.value === 'granAsuncion';
    document.getElementById('rapidoDepartmentWrapper').style.display = showDept ? 'block' : 'none';
  });

  document.getElementById('btnLimpiarRapido').addEventListener('click', () => {
    document.getElementById('formRapido').reset();
    document.getElementById('rapidoDepartmentWrapper').style.display = 'none';
    document.getElementById('resultadoRapidoWrapper').innerHTML = '';
  });
}

function construirInputsCalculoRapido() {
  return {
    clientName: document.getElementById('rapidoCliente').value.trim() || 'Cliente (cálculo rápido)',
    contactName: '',
    quoteDate: new Date().toISOString().slice(0, 10),
    projectName: '',
    validity: '',
    notes: '',
    serviceType: 'Auditoría en punto de venta',
    pdvCount: document.getElementById('rapidoPdvCount').value,
    productsPerPdv: document.getElementById('rapidoProductsPerPdv').value || 0,
    visitsPerPdv: document.getElementById('rapidoVisitsPerPdv').value || 1,
    frequency: document.getElementById('rapidoFrequency').value,
    durationMonths: document.getElementById('rapidoDurationMonths').value || 1,
    zone: document.getElementById('rapidoZone').value,
    department: document.getElementById('rapidoDepartment').value,
    auditorsMode: 'auto',
    auditorsCount: '',
    requiresTraslado: false,
    requiresAlojamiento: false,
    requiresViaticos: false,
    requiresFotografia: false,
    requiresInforme: false,
    requiresDashboard: false,
    requiresPresentacion: false,
    discountPercent: 0,
    extraCostManual: 0,
    extraCostReason: '',
  };
}

function procesarCalculoRapido() {
  const pdvCount = Number(document.getElementById('rapidoPdvCount').value);
  if (!pdvCount || pdvCount <= 0) {
    alert('Ingrese una cantidad de PDV válida para calcular.');
    return;
  }
  const inputs = construirInputsCalculoRapido();
  const config = getConfig();
  const resultado = calcularCotizacion(inputs, config);
  renderResultadoRapido(resultado, config, inputs);
}

function renderResultadoRapido(resultado, config, inputs) {
  const { desglose, isCustom, costoPromedioPorPdv } = resultado;
  const wrapper = document.getElementById('resultadoRapidoWrapper');
  const zonaLabel = { asuncion: 'Asunción', granAsuncion: 'Gran Asunción', interior: 'Interior' }[inputs.zone] || inputs.zone;

  wrapper.innerHTML = `
    <div class="card result-card">
      ${isCustom ? `<div class="alert alert-warning">La cantidad de PDV supera la escala máxima configurada. Este valor es <strong>estimado y está sujeto a revisión</strong>.</div>` : ''}
      <div class="result-header">
        <div>
          <h2>Estimación rápida</h2>
          <p class="muted">${inputs.pdvCount} PDV · ${zonaLabel}${inputs.department ? ' - ' + inputs.department : ''}</p>
        </div>
        <div class="total-badge">
          <span class="total-label">Total estimado</span>
          <span class="total-value">${formatearMoneda(desglose.total, config.moneda)}</span>
        </div>
      </div>

      <div class="result-grid">
        <div class="stat-card"><span class="stat-label">Precio base</span><span class="stat-value">${formatearMoneda(desglose.precioBaseCiclo, config.moneda)}</span></div>
        <div class="stat-card"><span class="stat-label">Costo promedio por PDV</span><span class="stat-value">${formatearMoneda(costoPromedioPorPdv, config.moneda)}</span></div>
        <div class="stat-card stat-card-margin"><span class="stat-label">Margen de ganancia (${desglose.margenPercent}%)</span><span class="stat-value">${formatearMoneda(desglose.margenComercial, config.moneda)}</span></div>
      </div>

      <div class="alert alert-info">
        Cálculo orientativo para uso durante reuniones comerciales. Para generar el documento oficial, complete el formulario de "Nueva cotización".
      </div>

      <div class="button-row">
        <button class="btn btn-primary" id="btnUsarEnCotizacionCompleta">Usar estos datos en cotización completa</button>
      </div>
    </div>
  `;

  document.getElementById('btnUsarEnCotizacionCompleta').addEventListener('click', () => {
    precargarFormularioDesdeInputs(inputs);
    cambiarVista('nueva');
  });
}

/**
 * Vuelca un objeto de "inputs" (como el que arma el formulario de cotización)
 * dentro del formulario de "Nueva cotización", para continuar el trabajo
 * comenzado en el cálculo rápido.
 */
function precargarFormularioDesdeInputs(inputs) {
  const f = document.getElementById('formCotizacion');
  Object.keys(inputs).forEach((key) => {
    if (!f[key]) return;
    if (f[key].type === 'checkbox') {
      f[key].checked = !!inputs[key];
    } else {
      f[key].value = inputs[key];
    }
  });
  if (inputs.clientName === 'Cliente (cálculo rápido)') {
    f.clientName.value = '';
  }
  attachMilesFormatting(document.getElementById('extraCostManual'));
  document.getElementById('departmentWrapper').style.display =
    (inputs.zone === 'interior' || inputs.zone === 'granAsuncion') ? 'block' : 'none';
  document.getElementById('auditorsCountWrapper').style.display =
    inputs.auditorsMode === 'manual' ? 'block' : 'none';
}

/* ==========================================================================
   6. UI - CONFIGURACION
   ========================================================================== */

function initConfiguracion() {
  document.getElementById('btnAgregarEscala').addEventListener('click', () => {
    const config = getConfig();
    config.scales.push({ id: cryptoId(), min: 0, max: 0, price: 0, productsIncluidos: 50 });
    saveConfig(config);
    renderConfiguracion();
  });

  CAMPOS_MONEDA_CONFIG.forEach((campo) => attachMilesFormatting(document.getElementById(campo)));

  document.getElementById('formConfigGeneral').addEventListener('submit', (e) => {
    e.preventDefault();
    guardarConfigGeneral();
  });

  document.getElementById('btnRestaurarConfig').addEventListener('click', () => {
    if (confirm('¿Restaurar todos los valores de ejemplo? Se perderán los cambios de configuración actuales.')) {
      saveConfig(getDefaultConfig());
      renderConfiguracion();
      alert('Configuración restaurada a los valores de ejemplo.');
    }
  });

  document.getElementById('btnExportarConfig').addEventListener('click', exportarConfiguracion);

  document.getElementById('inputImportarConfig').addEventListener('change', importarConfiguracion);
}

function renderConfiguracion() {
  const config = getConfig();
  renderTablaEscalas(config);
  rellenarFormularioConfigGeneral(config);
}

function renderTablaEscalas(config) {
  const tbody = document.getElementById('tablaEscalasBody');
  const scales = escalasOrdenadas(config.scales);
  const { errores, advertencias } = validarEscalas(config.scales);

  tbody.innerHTML = scales.map((s) => `
    <tr data-id="${s.id}">
      <td><input type="number" class="input-sm escala-min" value="${s.min}" min="1"></td>
      <td><input type="number" class="input-sm escala-max" value="${s.max}" min="1"></td>
      <td><input type="number" class="input-sm escala-products" value="${s.productsIncluidos !== undefined ? s.productsIncluidos : 50}" min="0"></td>
      <td><input type="text" class="input-sm escala-price" value="${formatMilesDisplay(s.price)}" inputmode="numeric"></td>
      <td class="col-actions">
        <button class="btn btn-tiny btn-secondary btn-guardar-escala">Guardar</button>
        <button class="btn btn-tiny btn-danger btn-eliminar-escala">Eliminar</button>
      </td>
    </tr>
  `).join('') || '<tr><td colspan="5" class="muted">No hay escalas configuradas. Agregue una escala para comenzar.</td></tr>';

  tbody.querySelectorAll('.escala-price').forEach(attachMilesFormatting);

  tbody.querySelectorAll('.btn-guardar-escala').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const row = e.target.closest('tr');
      const id = row.getAttribute('data-id');
      const cfg = getConfig();
      const scale = cfg.scales.find((s) => s.id === id);
      scale.min = Number(row.querySelector('.escala-min').value);
      scale.max = Number(row.querySelector('.escala-max').value);
      scale.productsIncluidos = Number(row.querySelector('.escala-products').value) || 0;
      scale.price = parseMilesValue(row.querySelector('.escala-price').value);
      saveConfig(cfg);
      renderConfiguracion();
    });
  });

  tbody.querySelectorAll('.btn-eliminar-escala').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      if (!confirm('¿Eliminar esta escala de precios?')) return;
      const row = e.target.closest('tr');
      const id = row.getAttribute('data-id');
      const cfg = getConfig();
      cfg.scales = cfg.scales.filter((s) => s.id !== id);
      saveConfig(cfg);
      renderConfiguracion();
    });
  });

  const alertBox = document.getElementById('escalasAlertBox');
  if (errores.length || advertencias.length) {
    alertBox.style.display = 'block';
    alertBox.innerHTML =
      (errores.length ? `<div class="alert alert-danger"><strong>Errores:</strong><ul>${errores.map((e) => `<li>${e}</li>`).join('')}</ul></div>` : '') +
      (advertencias.length ? `<div class="alert alert-warning"><strong>Advertencias:</strong><ul>${advertencias.map((a) => `<li>${a}</li>`).join('')}</ul></div>` : '');
  } else {
    alertBox.style.display = 'none';
    alertBox.innerHTML = '';
  }
}

function rellenarFormularioConfigGeneral(config) {
  const f = document.getElementById('formConfigGeneral');
  f.pricingMode.value = config.pricingMode;
  CAMPOS_MONEDA_CONFIG.forEach((campo) => {
    f[campo].value = formatMilesDisplay(config[campo]);
  });
  f.surchargeGranAsuncionPercent.value = config.surchargeGranAsuncionPercent;
  f.surchargeInteriorPercent.value = config.surchargeInteriorPercent;
  f.pdvPerAuditor.value = config.pdvPerAuditor;
  f.margenComercialPercent.value = config.margenComercialPercent;
  f.ivaPercent.value = config.ivaPercent;
  f.descuentoMaximoPercent.value = config.descuentoMaximoPercent;
}

function guardarConfigGeneral() {
  const f = document.getElementById('formConfigGeneral');
  const config = getConfig();

  const nuevaConfig = {
    ...config,
    pricingMode: f.pricingMode.value,
    surchargeGranAsuncionPercent: Number(f.surchargeGranAsuncionPercent.value),
    surchargeInteriorPercent: Number(f.surchargeInteriorPercent.value),
    pdvPerAuditor: Number(f.pdvPerAuditor.value),
    margenComercialPercent: Number(f.margenComercialPercent.value),
    ivaPercent: Number(f.ivaPercent.value),
    descuentoMaximoPercent: Number(f.descuentoMaximoPercent.value),
  };

  CAMPOS_MONEDA_CONFIG.forEach((campo) => {
    nuevaConfig[campo] = parseMilesValue(f[campo].value);
  });

  const camposNumericos = [
    ...CAMPOS_MONEDA_CONFIG, 'surchargeGranAsuncionPercent',
    'surchargeInteriorPercent', 'pdvPerAuditor', 'margenComercialPercent',
    'ivaPercent', 'descuentoMaximoPercent',
  ];
  const negativos = camposNumericos.filter((c) => nuevaConfig[c] < 0);
  if (negativos.length) {
    alert('Los siguientes campos no pueden ser negativos: ' + negativos.join(', '));
    return;
  }

  saveConfig(nuevaConfig);
  alert('Configuración de costos guardada correctamente.');
}

function exportarConfiguracion() {
  const config = getConfig();
  const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'configuracion-cotizador-pdv.json';
  a.click();
  URL.revokeObjectURL(url);
}

function importarConfiguracion(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (evt) => {
    try {
      const imported = JSON.parse(evt.target.result);
      if (!imported.scales || !Array.isArray(imported.scales)) {
        throw new Error('El archivo no tiene el formato esperado.');
      }
      if (confirm('¿Importar esta configuración? Se reemplazará la configuración actual.')) {
        saveConfig(imported);
        renderConfiguracion();
        alert('Configuración importada correctamente.');
      }
    } catch (err) {
      alert('No se pudo importar el archivo: ' + err.message);
    }
  };
  reader.readAsText(file);
  e.target.value = '';
}

/* ==========================================================================
   7. UI - HISTORIAL
   ========================================================================== */

function initHistorial() {
  document.getElementById('buscadorHistorial').addEventListener('input', renderHistorial);
  document.getElementById('filtroEstado').addEventListener('change', renderHistorial);
  document.getElementById('filtroZona').addEventListener('change', renderHistorial);
  document.getElementById('filtroFechaDesde').addEventListener('change', renderHistorial);
  document.getElementById('filtroFechaHasta').addEventListener('change', renderHistorial);
}

function renderHistorial() {
  const historial = getHistory();
  const busqueda = (document.getElementById('buscadorHistorial').value || '').toLowerCase();
  const estado = document.getElementById('filtroEstado').value;
  const zona = document.getElementById('filtroZona').value;
  const desde = document.getElementById('filtroFechaDesde').value;
  const hasta = document.getElementById('filtroFechaHasta').value;

  const filtrado = historial.filter((q) => {
    const coincideTexto = !busqueda ||
      q.cliente.toLowerCase().includes(busqueda) ||
      q.numero.toLowerCase().includes(busqueda);
    const coincideEstado = !estado || q.estado === estado;
    const coincideZona = !zona || q.zona === zona;
    const coincideDesde = !desde || q.fecha >= desde;
    const coincideHasta = !hasta || q.fecha <= hasta;
    return coincideTexto && coincideEstado && coincideZona && coincideDesde && coincideHasta;
  });

  const tbody = document.getElementById('tablaHistorialBody');
  const zonaLabel = { asuncion: 'Asunción', granAsuncion: 'Gran Asunción', interior: 'Interior' };

  if (filtrado.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="muted">No hay cotizaciones que coincidan con la búsqueda.</td></tr>';
    return;
  }

  tbody.innerHTML = filtrado.slice().reverse().map((q) => `
    <tr>
      <td>${q.numero}</td>
      <td>${q.cliente}</td>
      <td>${q.fecha}</td>
      <td>${q.pdv}</td>
      <td>${zonaLabel[q.zona] || q.zona}</td>
      <td>${formatearMoneda(q.total, getConfig().moneda)}</td>
      <td>
        <select class="input-sm select-estado" data-id="${q.id}">
          ${['Borrador', 'Enviada', 'Aprobada', 'Rechazada', 'Vencida'].map((e) =>
            `<option value="${e}" ${e === q.estado ? 'selected' : ''}>${e}</option>`).join('')}
        </select>
      </td>
      <td class="col-actions">
        <button class="btn btn-tiny btn-secondary btn-ver" data-id="${q.id}">Ver</button>
        <button class="btn btn-tiny btn-secondary btn-editar" data-id="${q.id}">Editar</button>
        <button class="btn btn-tiny btn-secondary btn-duplicar" data-id="${q.id}">Duplicar</button>
        <button class="btn btn-tiny btn-secondary btn-pdf" data-id="${q.id}">PDF</button>
        <button class="btn btn-tiny btn-danger btn-eliminar" data-id="${q.id}">Eliminar</button>
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('.select-estado').forEach((sel) => {
    sel.addEventListener('change', (e) => {
      const historial = getHistory();
      const record = historial.find((q) => q.id === e.target.getAttribute('data-id'));
      record.estado = e.target.value;
      saveHistory(historial);
    });
  });

  tbody.querySelectorAll('.btn-ver').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const record = getHistory().find((q) => q.id === e.target.getAttribute('data-id'));
      mostrarVistaPrevia(record.resultado, getConfig(), record.numero);
    });
  });

  tbody.querySelectorAll('.btn-editar').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const record = getHistory().find((q) => q.id === e.target.getAttribute('data-id'));
      cargarCotizacionEnFormulario(record);
      cambiarVista('nueva');
    });
  });

  tbody.querySelectorAll('.btn-duplicar').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const record = getHistory().find((q) => q.id === e.target.getAttribute('data-id'));
      const historial = getHistory();
      const nuevoNumero = getNextQuoteNumber();
      const copia = JSON.parse(JSON.stringify(record));
      copia.id = cryptoId();
      copia.numero = nuevoNumero;
      copia.estado = 'Borrador';
      historial.push(copia);
      saveHistory(historial);
      renderHistorial();
      alert(`Cotización duplicada como ${nuevoNumero}.`);
    });
  });

  tbody.querySelectorAll('.btn-pdf').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const record = getHistory().find((q) => q.id === e.target.getAttribute('data-id'));
      generarPdf(record.resultado, getConfig(), record.numero, 'interno');
    });
  });

  tbody.querySelectorAll('.btn-eliminar').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      if (!confirm('¿Eliminar esta cotización del historial? Esta acción no se puede deshacer.')) return;
      const id = e.target.getAttribute('data-id');
      const historial = getHistory().filter((q) => q.id !== id);
      saveHistory(historial);
      renderHistorial();
    });
  });
}

function cargarCotizacionEnFormulario(record) {
  const inputs = record.resultado.inputs;
  const f = document.getElementById('formCotizacion');
  Object.keys(inputs).forEach((key) => {
    if (!f[key]) return;
    if (f[key].type === 'checkbox') {
      f[key].checked = !!inputs[key];
    } else {
      f[key].value = inputs[key];
    }
  });
  document.getElementById('departmentWrapper').style.display =
    (inputs.zone === 'interior' || inputs.zone === 'granAsuncion') ? 'block' : 'none';
  document.getElementById('auditorsCountWrapper').style.display =
    inputs.auditorsMode === 'manual' ? 'block' : 'none';

  APP_STATE.editingQuoteId = record.id;
  const config = getConfig();
  const resultado = calcularCotizacion(inputs, config);
  APP_STATE.lastResult = resultado;
  renderResultado(resultado, config);
}

/* ==========================================================================
   8. VISTA PREVIA / PDF
   ========================================================================== */

function mostrarVistaPrevia(resultado, config, numero) {
  const modal = document.getElementById('modalVistaPrevia');
  const contenido = document.getElementById('modalVistaPreviaContenido');
  contenido.innerHTML = construirHtmlPreview(resultado, config, numero, 'cliente');
  modal.classList.add('open');
}

document.addEventListener('DOMContentLoaded', () => {
  const closeBtn = document.getElementById('btnCerrarModal');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      document.getElementById('modalVistaPrevia').classList.remove('open');
    });
  }
  const modal = document.getElementById('modalVistaPrevia');
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.remove('open');
    });
  }
});

function construirHtmlPreview(resultado, config, numero, tipo) {
  const { inputs, desglose, ciclos, totalProductos, totalVisitas } = resultado;
  const zonaLabel = { asuncion: 'Asunción', granAsuncion: 'Gran Asunción', interior: 'Interior' }[inputs.zone] || inputs.zone;

  const filasInternas = tipo === 'interno' ? `
    <tr><td>Margen de ganancia (${desglose.margenPercent}%)</td><td>${formatearMoneda(desglose.margenComercial, config.moneda)}</td></tr>
  ` : '';

  return `
    <div class="preview-doc">
      <h2>Cotización de Servicios de Auditoría en PDV</h2>
      <p class="muted">N° ${numero} · Fecha: ${inputs.quoteDate}${inputs.validity ? ' · Vigencia: ' + inputs.validity + ' días' : ''}</p>
      <hr>
      <h3>Cliente</h3>
      <p>${inputs.clientName}${inputs.contactName ? ' — Contacto: ' + inputs.contactName : ''}</p>
      ${inputs.projectName ? `<p>Proyecto: ${inputs.projectName}</p>` : ''}

      <h3>Alcance del servicio</h3>
      <table class="breakdown-table">
        <tbody>
          <tr><td>Tipo de servicio</td><td>${inputs.serviceType}</td></tr>
          <tr><td>Cantidad de PDV</td><td>${inputs.pdvCount}</td></tr>
          <tr><td>Productos por PDV</td><td>${inputs.productsPerPdv}</td></tr>
          <tr><td>Total de productos a auditar</td><td>${totalProductos.toLocaleString('es-PY')}</td></tr>
          <tr><td>Zona</td><td>${zonaLabel}${inputs.department ? ' - ' + inputs.department : ''}</td></tr>
          <tr><td>Visitas totales</td><td>${totalVisitas}</td></tr>
          <tr><td>Duración</td><td>${inputs.durationMonths} mes(es)</td></tr>
        </tbody>
      </table>

      <h3>Costos</h3>
      <table class="breakdown-table">
        <tbody>
          <tr><td>Subtotal recurrente</td><td>${formatearMoneda(desglose.subtotalRecurrente, config.moneda)}</td></tr>
          <tr><td>Recargo de zona</td><td>${formatearMoneda(desglose.recargoZona, config.moneda)}</td></tr>
          <tr><td>Costos operativos y servicios adicionales</td><td>${formatearMoneda(desglose.subtotalOperativo, config.moneda)}</td></tr>
          ${filasInternas}
          <tr><td>Descuento (${desglose.descuentoPercent}%)</td><td>- ${formatearMoneda(desglose.montoDescuento, config.moneda)}</td></tr>
          <tr><td>IVA (${desglose.ivaPercent}%)</td><td>${formatearMoneda(desglose.montoIva, config.moneda)}</td></tr>
          <tr class="total-row"><td>TOTAL ESTIMADO</td><td>${formatearMoneda(desglose.total, config.moneda)}</td></tr>
        </tbody>
      </table>

      <p class="muted" style="margin-top:16px;font-size:12px;">
        Cotización estimativa y sujeta a validación comercial y operativa. El precio final puede variar según el alcance definitivo,
        ubicación de los puntos de venta y requerimientos adicionales del cliente.
      </p>
    </div>
  `;
}

function generarPdf(resultado, config, numero, tipo) {
  if (!window.jspdf) {
    alert('No se pudo cargar la librería de generación de PDF. Verifique su conexión a internet.');
    return;
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const { inputs, desglose, ciclos, totalProductos, totalVisitas } = resultado;
  const margin = 40;
  let y = margin;
  const lineHeight = 16;
  const pageWidth = doc.internal.pageSize.getWidth();

  function addLine(text, opts = {}) {
    const size = opts.size || 10;
    doc.setFontSize(size);
    doc.setFont(undefined, opts.bold ? 'bold' : 'normal');
    if (y > 780) {
      doc.addPage();
      y = margin;
    }
    doc.text(text, margin, y);
    y += opts.lh || lineHeight;
  }

  function addRow(label, value) {
    if (y > 780) {
      doc.addPage();
      y = margin;
    }
    doc.setFontSize(10);
    doc.setFont(undefined, 'normal');
    doc.text(label, margin, y);
    doc.text(value, pageWidth - margin, y, { align: 'right' });
    y += lineHeight;
  }

  const zonaLabel = { asuncion: 'Asunción', granAsuncion: 'Gran Asunción', interior: 'Interior' }[inputs.zone] || inputs.zone;

  addLine('Cotización de Servicios de Auditoría en PDV', { size: 16, bold: true, lh: 24 });
  addLine(`N° ${numero}  ·  Fecha: ${inputs.quoteDate}${inputs.validity ? '  ·  Vigencia: ' + inputs.validity + ' días' : ''}`, { size: 10, lh: 22 });

  addLine('DATOS DEL CLIENTE', { bold: true, size: 12, lh: 18 });
  addRow('Cliente', inputs.clientName);
  if (inputs.contactName) addRow('Contacto', inputs.contactName);
  if (inputs.projectName) addRow('Proyecto', inputs.projectName);
  y += 8;

  addLine('ALCANCE DEL SERVICIO', { bold: true, size: 12, lh: 18 });
  addRow('Tipo de servicio', inputs.serviceType);
  addRow('Cantidad de PDV', String(inputs.pdvCount));
  addRow('Productos por PDV', String(inputs.productsPerPdv));
  addRow('Total de productos a auditar', totalProductos.toLocaleString('es-PY'));
  addRow('Zona', zonaLabel + (inputs.department ? ' - ' + inputs.department : ''));
  addRow('Visitas totales', String(totalVisitas));
  addRow('Duración', `${inputs.durationMonths} mes(es) (${ciclos} ciclos)`);
  addRow('Auditores requeridos', String(desglose.cantidadAuditores));
  y += 8;

  addLine('COSTOS', { bold: true, size: 12, lh: 18 });
  addRow('Precio base por ciclo', formatearMoneda(desglose.precioBaseCiclo, config.moneda));
  addRow('Recargo productos adicionales (por ciclo)', formatearMoneda(desglose.recargoProductosCiclo, config.moneda));
  addRow('Recargo visitas adicionales (por ciclo)', formatearMoneda(desglose.recargoVisitasCiclo, config.moneda));
  addRow(`Subtotal recurrente (x${ciclos})`, formatearMoneda(desglose.subtotalRecurrente, config.moneda));
  addRow(`Recargo de zona (${desglose.porcentajeZona}%)`, formatearMoneda(desglose.recargoZona, config.moneda));
  addRow('Costos operativos y servicios adicionales', formatearMoneda(desglose.subtotalOperativo, config.moneda));

  if (tipo === 'interno') {
    addRow(`Margen de ganancia (${desglose.margenPercent}%)`, formatearMoneda(desglose.margenComercial, config.moneda));
  }

  addRow(`Descuento (${desglose.descuentoPercent}%)`, '- ' + formatearMoneda(desglose.montoDescuento, config.moneda));
  addRow(`IVA (${desglose.ivaPercent}%)`, formatearMoneda(desglose.montoIva, config.moneda));

  y += 4;
  doc.setDrawColor(200);
  doc.line(margin, y, pageWidth - margin, y);
  y += 18;
  addLine(`TOTAL ESTIMADO: ${formatearMoneda(desglose.total, config.moneda)}`, { bold: true, size: 13, lh: 20 });

  y += 10;
  doc.setFontSize(8);
  doc.setFont(undefined, 'italic');
  const disclaimer = doc.splitTextToSize(
    'Cotización estimativa y sujeta a validación comercial y operativa. El precio final puede variar según el alcance definitivo, ubicación de los puntos de venta y requerimientos adicionales del cliente.',
    pageWidth - margin * 2
  );
  doc.text(disclaimer, margin, y);

  const sufijo = tipo === 'interno' ? 'interno' : 'cliente';
  doc.save(`${numero.replace(/\s.*$/, '')}-${sufijo}.pdf`);
}

/* ==========================================================================
   9. INICIALIZACION
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  getConfig(); // asegura que exista configuración en localStorage
  initNavegacion();
  initFormularioCotizacion();
  initCalculoRapido();
  initConfiguracion();
  initHistorial();
  cambiarVista('nueva');
});
