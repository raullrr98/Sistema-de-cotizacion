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

    // --- Mano de obra (horas hombre), con cargas sociales (VALORES DE EJEMPLO) ---
    costoPorHoraHombre: 25000, // Gs. por hora de trabajo del auditor, sin cargas
    horasPorVisitaPdv: 2, // horas que un auditor dedica a cada visita de un PDV
    aguinaldoPercent: 8.33, // % legal del aguinaldo (equivalente a 1/12 del salario)
    ipsPatronalPercent: 16.5, // % de aporte patronal al IPS

    // --- Mystery Shopper (VALORES DE EJEMPLO, basados en costeo de referencia) ---
    msTrasladoPorVisitaHoras: 0.5, // horas de traslado ida y vuelta, por visita presencial
    msEsperaInteraccionHoras: 0.5, // horas de espera + interacción con el asesor, por visita
    msCargaInformeHoras: 0.25, // horas de carga de informe/evidencia, por visita
    msJornadaEfectivaHorasDia: 6, // horas efectivas de campo por día, por shopper
    msTiempoGestionInteraccionHoras: 0.4, // horas de gestión por interacción remota (WhatsApp/Redes/Web)
    msHorasDisenoGuion: 6, // horas de diseño de guion y briefing (tarea única, no por visita)
    msHorasAnalisisInforme: 8, // horas de análisis y armado de informe final (tarea única)
    msCostoHoraShopper: 22000, // Gs. por hora de trabajo del mystery shopper / relevador
    msCostoHoraAnalista: 48000, // Gs. por hora de trabajo del analista / coordinador
    msViaticoPorVisita: 35000, // Gs. de viático de movilidad, por visita presencial

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

// Etiquetas legibles para cada zona (se usan en toda la aplicación).
const ZONA_LABELS = {
  asuncion: 'Asunción',
  granAsuncion: 'Gran Asunción',
  interior: 'Interior',
  combinada: 'Combinada (Asunción + Gran Asunción + Interior)',
};

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
 * Calcula la cotización completa de un servicio de Mystery Shopper,
 * replicando exactamente la lógica del modelo de costeo de referencia:
 *   A. Trabajo de campo presencial (visitas a sucursales)
 *   B. Viáticos de movilidad
 *   C. Canales remotos (WhatsApp / Redes / Web)
 *   D. Coordinación y análisis (diseño de guion + informe final)
 *   E. Resumen: mano de obra + viáticos, margen, descuento e IVA
 */
function calcularMysteryShopper(inputs, config) {
  const aseguradoras = Number(inputs.msAseguradorasCount) || 0;
  const sucursales = Number(inputs.msSucursalesPresencial) || 0;
  const canalesRemotos = Number(inputs.msCanalesRemotos) || 0;
  const rondas = Math.max(1, Number(inputs.msRondas) || 1);
  const plazoDeseadoDias = Math.max(1, Number(inputs.msPlazoDeseadoDias) || 1);

  // --- A. Trabajo de campo presencial ---
  const trasladoHoras = Number(config.msTrasladoPorVisitaHoras) || 0;
  const esperaHoras = Number(config.msEsperaInteraccionHoras) || 0;
  const cargaInformeHoras = Number(config.msCargaInformeHoras) || 0;
  const horasPorVisita = trasladoHoras + esperaHoras + cargaInformeHoras;

  const visitasTotales = sucursales * rondas;
  const horasHombreCampo = visitasTotales * horasPorVisita;

  const jornadaEfectiva = Number(config.msJornadaEfectivaHorasDia) || 0;
  const visitasPorDiaPorShopper = horasPorVisita > 0 ? Math.floor(jornadaEfectiva / horasPorVisita) : 0;
  const diasNecesariosConUnaPersona = visitasPorDiaPorShopper > 0
    ? Math.ceil(visitasTotales / visitasPorDiaPorShopper)
    : (visitasTotales > 0 ? visitasTotales : 0);
  const shoppersNecesarios = diasNecesariosConUnaPersona > 0
    ? Math.ceil(diasNecesariosConUnaPersona / plazoDeseadoDias)
    : 0;

  const costoHoraShopper = Number(config.msCostoHoraShopper) || 0;
  const costoCampoManoObra = horasHombreCampo * costoHoraShopper;

  // --- B. Viáticos ---
  const viaticoPorVisita = Number(config.msViaticoPorVisita) || 0;
  const viaticosTotales = visitasTotales * viaticoPorVisita;

  // --- C. Canales remotos ---
  const interaccionesTotales = aseguradoras * canalesRemotos * rondas;
  const tiempoGestionHoras = Number(config.msTiempoGestionInteraccionHoras) || 0;
  const horasHombreRemoto = interaccionesTotales * tiempoGestionHoras;
  const costoRemotoManoObra = horasHombreRemoto * costoHoraShopper;

  // --- D. Coordinación y análisis ---
  const horasDisenoGuion = Number(config.msHorasDisenoGuion) || 0;
  const horasAnalisisInforme = Number(config.msHorasAnalisisInforme) || 0;
  const horasCoordinacion = horasDisenoGuion + horasAnalisisInforme;
  const costoHoraAnalista = Number(config.msCostoHoraAnalista) || 0;
  const costoCoordinacion = horasCoordinacion * costoHoraAnalista;

  // --- E. Resumen y total ---
  const subtotalManoObra = costoCampoManoObra + costoRemotoManoObra + costoCoordinacion;
  const subtotalGeneral = subtotalManoObra + viaticosTotales;

  const costoAdicionalManual = Number(inputs.extraCostManual) || 0;
  const subtotalAntesMargen = subtotalGeneral + costoAdicionalManual;

  const margenPercent = Number(config.margenComercialPercent) || 0;
  const margenComercial = subtotalAntesMargen * (margenPercent / 100);
  const subtotalConMargen = subtotalAntesMargen + margenComercial;

  const descuentoMax = Number(config.descuentoMaximoPercent) || 0;
  let descuentoPercent = Number(inputs.discountPercent) || 0;
  if (descuentoPercent > descuentoMax) descuentoPercent = descuentoMax;
  if (descuentoPercent < 0) descuentoPercent = 0;
  const montoDescuento = subtotalConMargen * (descuentoPercent / 100);
  const subtotalConDescuento = subtotalConMargen - montoDescuento;

  const ivaPercent = Number(config.ivaPercent) || 0;
  const montoIva = subtotalConDescuento * (ivaPercent / 100);

  const total = subtotalConDescuento + montoIva;

  return {
    inputs,
    isCustom: false,
    desglose: {
      horasPorVisita,
      visitasTotales,
      horasHombreCampo,
      visitasPorDiaPorShopper,
      diasNecesariosConUnaPersona,
      shoppersNecesarios,
      costoCampoManoObra,
      viaticosTotales,
      interaccionesTotales,
      horasHombreRemoto,
      costoRemotoManoObra,
      horasCoordinacion,
      costoCoordinacion,
      subtotalManoObra,
      subtotalGeneral,
      costoAdicionalManual,
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
    totalVisitas: visitasTotales,
    totalInteracciones: interaccionesTotales,
    costoMensualEstimado: total, // proyecto puntual: no tiene recurrencia mensual
    costoPromedioPorSucursal: sucursales > 0 ? total / sucursales : 0,
    costoPromedioPorAseguradora: aseguradoras > 0 ? total / aseguradoras : 0,
  };
}

// Etiquetas legibles de cada tipo de servicio (se usan en toda la aplicación).
const SERVICE_TYPE_LABELS = {
  auditoria: 'Auditoría en punto de venta',
  mysteryShopper: 'Mystery Shopper',
};

/** Determina si una cotización corresponde al servicio de Mystery Shopper. */
function esMysteryShopper(inputs) {
  return inputs.serviceType === 'mysteryShopper';
}

/**
 * Punto de entrada único para calcular cualquier tipo de cotización.
 * Deriva al motor de cálculo correspondiente según el tipo de servicio.
 * Cualquier valor antiguo o desconocido (incluida la cadena literal que
 * usaban versiones anteriores) cae por defecto en "Auditoría en PDV".
 */
function calcularCotizacion(inputs, config) {
  if (esMysteryShopper(inputs)) {
    return calcularMysteryShopper(inputs, config);
  }
  return calcularAuditoriaPDV(inputs, config);
}

/**
 * Calcula la cotización completa de una Auditoría en PDV. Recibe los datos
 * del formulario (inputs) y la configuración de costos (config). Devuelve
 * un objeto con todo el desglose necesario para mostrar el resultado y
 * generar el PDF.
 */
function calcularAuditoriaPDV(inputs, config) {
  const pdv = Number(inputs.pdvCount) || 0;
  const productosPorPdv = Number(inputs.productsPerPdv) || 0;
  const visitasPorPdv = Number(inputs.visitsPerPdv) || 1;
  const duracionMeses = Number(inputs.durationMonths) || 1;
  const ciclos = calcularCiclos(inputs.frequency, duracionMeses);
  const totalVisitas = visitasPorPdv * ciclos * pdv;

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
  if (inputs.zone === 'granAsuncion') {
    porcentajeZona = Number(config.surchargeGranAsuncionPercent) || 0;
  } else if (inputs.zone === 'interior') {
    porcentajeZona = Number(config.surchargeInteriorPercent) || 0;
  } else if (inputs.zone === 'combinada') {
    // Zona combinada: se distribuyen los PDV entre las 3 zonas y se calcula
    // un porcentaje de recargo PONDERADO según qué proporción de PDV cae en
    // cada zona (Asunción no suma recargo).
    const pAsuncion = Number(inputs.pdvAsuncion) || 0;
    const pGranAsuncion = Number(inputs.pdvGranAsuncion) || 0;
    const pInterior = Number(inputs.pdvInterior) || 0;
    const totalZona = pAsuncion + pGranAsuncion + pInterior;
    const base = totalZona > 0 ? totalZona : pdv;
    if (base > 0) {
      porcentajeZona =
        (pGranAsuncion * (Number(config.surchargeGranAsuncionPercent) || 0) +
          pInterior * (Number(config.surchargeInteriorPercent) || 0)) / base;
    }
  }
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

  // --- 7B. Mano de obra (horas hombre), con cargas sociales (aguinaldo + IPS) ---
  // Costo real de la hora trabajada por los auditores, incluyendo las cargas
  // sociales obligatorias, para que el precio contemple el costo laboral real.
  const horasPorVisita = Number(config.horasPorVisitaPdv) || 0;
  const horasHombreTotales = horasPorVisita * totalVisitas;
  const aguinaldoPercent = Number(config.aguinaldoPercent) || 0;
  const ipsPatronalPercent = Number(config.ipsPatronalPercent) || 0;
  const costoHoraHombreCargado = (Number(config.costoPorHoraHombre) || 0) * (1 + (aguinaldoPercent + ipsPatronalPercent) / 100);
  const costoManoDeObra = horasHombreTotales * costoHoraHombreCargado;

  // --- 8. Costo adicional manual ---
  const costoAdicionalManual = Number(inputs.extraCostManual) || 0;

  const subtotalOperativo =
    costoTraslado + costoViaticos + costoAlojamiento +
    costoFotografia + costoInforme + costoDashboard + costoPresentacion +
    costoManoDeObra + costoAdicionalManual;

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

  const costoPromedioPorPdv = pdv > 0 ? total / pdv : 0;
  const costoPromedioPorVisita = totalVisitas > 0 ? total / totalVisitas : 0;
  // Costo mensual estimado: distribuye el total del proyecto entre la
  // cantidad de meses de duración, para dar una referencia de gasto mensual.
  const costoMensualEstimado = total / duracionMeses;

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
      horasHombreTotales,
      costoHoraHombreCargado,
      costoManoDeObra,
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
    costoMensualEstimado,
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
  'costoInformeFinal', 'costoDashboard', 'costoPresentacion', 'costoPorHoraHombre',
  'msCostoHoraShopper', 'msCostoHoraAnalista', 'msViaticoPorVisita',
];

function validarFormularioCotizacion(inputs) {
  const errores = [];

  if (!inputs.clientName || inputs.clientName.trim() === '') {
    errores.push('El nombre del cliente o empresa es obligatorio.');
  }
  if (!inputs.quoteDate) {
    errores.push('La fecha de cotización es obligatoria.');
  }

  if (esMysteryShopper(inputs)) {
    // --- Validaciones específicas de Mystery Shopper ---
    const aseguradoras = Number(inputs.msAseguradorasCount) || 0;
    const sucursales = Number(inputs.msSucursalesPresencial) || 0;
    if (aseguradoras < 0) {
      errores.push('La cantidad de aseguradoras a monitorear no puede ser negativa.');
    }
    if (sucursales < 0) {
      errores.push('La cantidad de sucursales a visitar no puede ser negativa.');
    }
    if (aseguradoras === 0 && sucursales === 0) {
      errores.push('Debe indicar al menos una aseguradora a monitorear o una sucursal a visitar.');
    }
    if (!inputs.msCanalesRemotos || Number(inputs.msCanalesRemotos) < 0) {
      errores.push('La cantidad de canales remotos por aseguradora no es válida.');
    }
    if (!inputs.msRondas || Number(inputs.msRondas) <= 0) {
      errores.push('La cantidad de rondas de relevamiento debe ser mayor que cero.');
    }
    if (!inputs.msPlazoDeseadoDias || Number(inputs.msPlazoDeseadoDias) <= 0) {
      errores.push('El plazo deseado (días hábiles) debe ser mayor que cero.');
    }
  } else {
    // --- Validaciones específicas de Auditoría en PDV ---
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
    if (inputs.zone === 'combinada') {
      const pAsuncion = Number(inputs.pdvAsuncion) || 0;
      const pGranAsuncion = Number(inputs.pdvGranAsuncion) || 0;
      const pInterior = Number(inputs.pdvInterior) || 0;
      const sumaZonas = pAsuncion + pGranAsuncion + pInterior;
      if (sumaZonas !== Number(inputs.pdvCount)) {
        errores.push(`La suma de PDV por zona (${sumaZonas}) debe ser igual a la cantidad total de PDV (${inputs.pdvCount}).`);
      }
    }
    if (inputs.auditorsMode === 'manual' && (!inputs.auditorsCount || Number(inputs.auditorsCount) <= 0)) {
      errores.push('Debe indicar una cantidad de auditores válida en modo manual.');
    }
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
   3B. AYUDA CONTEXTUAL (ICONOS "i")
   --------------------------------------------------------------------------
   Textos explicativos que se muestran al hacer clic en el icono "i" junto
   a cada campo, para que cualquier persona que use el sistema entienda
   exactamente qué significa el valor y cómo se aplica en el cálculo.
   ========================================================================== */

const INFO_TEXTS = {
  // --- Nueva cotización: Datos del cliente ---
  clientName: 'Nombre del cliente o empresa que recibe la cotización. Aparece en el documento final, en el PDF y en el historial.',
  contactName: 'Nombre de la persona de contacto en la empresa del cliente (opcional). Es solo informativo: no afecta el cálculo del precio.',
  quoteDate: 'Fecha en la que se emite la cotización. Se usa para el historial y como referencia para calcular la vigencia.',
  projectName: 'Nombre interno del proyecto o campaña (opcional). Sirve para identificar la cotización más fácilmente en el historial.',
  validity: 'Cantidad de días que la cotización es válida desde la fecha de emisión. Es solo informativo: el sistema no la vence automáticamente; el estado se cambia manualmente en el historial.',
  notes: 'Cualquier observación adicional que quiera dejar registrada en la cotización. No afecta el cálculo del precio.',

  // --- Nueva cotización: Datos del servicio ---
  serviceType: 'Tipo de servicio a cotizar. Según lo que elija, el formulario cambia para pedirle los datos correctos: "Auditoría en punto de venta" (PDV, productos, zona, etc.) o "Mystery Shopper" (aseguradoras, sucursales, canales remotos, etc.).',
  pdvCount: 'Cantidad total de puntos de venta (locales/sucursales) a auditar. Es el dato principal: define automáticamente qué escala de precio se usa (ver "Escalas de precio" en Configuración).',
  productsPerPdv: 'Cantidad aproximada de productos que se van a relevar EN CADA PDV (no el total). Si este número supera la cantidad de "Productos incluidos" de la escala correspondiente, se cobra un recargo por CADA producto que se pase, multiplicado por la cantidad de PDV.',
  visitsPerPdv: 'Cantidad de visitas que se realizan a CADA PDV dentro de un mismo ciclo (por ejemplo, dentro de un mes si la frecuencia es mensual). La primera visita ya está incluida en el precio base; desde la segunda en adelante se cobra el "Costo por visita adicional" configurado.',
  frequency: 'Con qué periodicidad se repite el servicio. "Única" = una sola vez. Semanal/Quincenal/Mensual se repiten durante toda la "Duración del proyecto". Junto con la duración, define la cantidad de "ciclos" de cobro.',
  durationMonths: 'Cantidad de meses que dura el proyecto. Combinado con la frecuencia, determina la cantidad de ciclos de cobro. Ejemplo: frecuencia mensual x 3 meses = 3 ciclos completos.',
  zone: 'Ubicación general de los PDV. "Asunción" no tiene recargo. "Gran Asunción" e "Interior" suman el porcentaje de recargo de zona configurado en Configuración de costos. "Combinada" permite repartir los PDV entre las 3 zonas cuando el cliente tiene locales en distintos lugares del país.',
  department: 'Departamento o ciudad específica (por ejemplo, dentro de Gran Asunción o Interior). Es solo informativo: no cambia el precio, solo aparece en el documento.',
  pdvAsuncion: 'Cantidad de PDV ubicados en Asunción (sin recargo de zona). La suma de los 3 campos de zona debe ser igual a la "Cantidad de puntos de venta" total.',
  pdvGranAsuncion: 'Cantidad de PDV ubicados en Gran Asunción. Se les aplica el recargo de zona configurado para Gran Asunción. La suma de los 3 campos debe ser igual al total de PDV.',
  pdvInterior: 'Cantidad de PDV ubicados en el Interior del país. Se les aplica el recargo de zona configurado para Interior. La suma de los 3 campos debe ser igual al total de PDV.',
  auditorsMode: '"Automático": el sistema calcula la cantidad de auditores dividiendo la cantidad de PDV entre la capacidad configurada en "PDV cubiertos por auditor" (Configuración). "Manual": usted define la cantidad exacta de auditores.',
  auditorsCount: 'Cantidad exacta de auditores a asignar (solo si eligió el modo "Manual"). Este número se usa para calcular el costo de traslado, viáticos y alojamiento si están marcados.',

  // --- Nueva cotización: Mystery Shopper (alcance) ---
  msAseguradorasCount: 'Cantidad de aseguradoras de la competencia a monitorear. Este número se usa para calcular las interacciones y el costo de los canales remotos (WhatsApp, Redes Sociales, Web).',
  msSucursalesPresencial: 'Cantidad de sucursales a visitar en persona (trabajo de campo, dentro de Asunción). Si no requiere visitas presenciales, deje este valor en 0.',
  msCanalesRemotos: 'Cantidad de canales remotos a monitorear por cada aseguradora (por ejemplo: WhatsApp + Redes Sociales + Web = 3). Se multiplica por la cantidad de aseguradoras y de rondas para calcular las interacciones totales.',
  msRondas: 'Cantidad de veces que se repite todo el relevamiento (presencial y remoto). 1 = una sola medición; 2 o más = repetir para controlar variabilidad en el tiempo.',
  msPlazoDeseadoDias: 'Cantidad de días hábiles en los que se desea completar el trabajo de campo presencial. A menor plazo, se necesitan más mystery shoppers trabajando en simultáneo.',

  // --- Nueva cotización: Servicios adicionales ---
  requiresTraslado: 'Si se marca, se suma el "Costo de traslado" configurado, multiplicado por la cantidad de auditores y por la cantidad de ciclos del proyecto (se asume 1 viaje por ciclo).',
  requiresAlojamiento: 'Si se marca, se suma el costo de "Alojamiento por auditor, por noche" configurado, multiplicado por la cantidad de auditores y de ciclos (se asume 1 noche por ciclo).',
  requiresViaticos: 'Si se marca, se suma el "Viático por auditor, por día" configurado, multiplicado por la cantidad de auditores y de ciclos (se asume 1 día por ciclo).',
  requiresFotografia: 'Si se marca, se suma UNA SOLA VEZ el costo de "Evidencia fotográfica" configurado. Es un cargo único: no se multiplica por PDV ni por ciclos.',
  requiresInforme: 'Si se marca, se suma UNA SOLA VEZ el costo de "Informe final" configurado. Es un cargo único, no se repite.',
  requiresDashboard: 'Si se marca, se suma UNA SOLA VEZ el costo de "Dashboard" configurado. Es un cargo único, no se repite.',
  requiresPresentacion: 'Si se marca, se suma UNA SOLA VEZ el costo de "Presentación de resultados" configurado. Es un cargo único, no se repite.',

  // --- Nueva cotización: Ajustes comerciales ---
  discountPercent: 'Porcentaje de descuento que se aplica sobre el subtotal con margen ya incluido. No puede superar el "Descuento máximo permitido" definido en Configuración de costos: si ingresa un valor mayor, el sistema lo recorta automáticamente.',
  extraCostManual: 'Monto en guaraníes que se suma manualmente SOLO a esta cotización puntual (por ejemplo, un requerimiento especial del cliente). Si carga un valor mayor a 0, es obligatorio explicar el motivo.',
  extraCostReason: 'Explicación breve del motivo del costo adicional manual. Es obligatoria únicamente si el "Costo adicional manual" es mayor a 0.',

  // --- Cálculo rápido ---
  rapidoCliente: 'Nombre del cliente (opcional). Si lo completa, se transfiere al formulario de "Nueva cotización" al presionar "Usar estos datos".',
  rapidoPdvCount: 'Cantidad de puntos de venta a auditar. Es el único dato obligatorio para poder calcular un estimado rápido.',
  rapidoProductsPerPdv: 'Cantidad aproximada de productos por cada PDV. Si supera lo incluido en la escala correspondiente, se recarga por cada producto adicional (igual que en la cotización completa).',
  rapidoZone: 'Ubicación de los PDV. Gran Asunción e Interior aplican el recargo de zona configurado. "Combinada" permite repartir los PDV entre las 3 zonas.',
  rapidoDepartment: 'Departamento o ciudad específica. Solo informativo.',
  rapidoPdvAsuncion: 'Cantidad de PDV en Asunción (sin recargo). La suma de los 3 campos debe ser igual al total de PDV.',
  rapidoPdvGranAsuncion: 'Cantidad de PDV en Gran Asunción (con su recargo de zona). La suma de los 3 campos debe ser igual al total de PDV.',
  rapidoPdvInterior: 'Cantidad de PDV en el Interior (con su recargo de zona). La suma de los 3 campos debe ser igual al total de PDV.',
  rapidoVisitsPerPdv: 'Cantidad de visitas a cada PDV por ciclo. La primera está incluida; desde la segunda se cobra el costo de visita adicional.',
  rapidoFrequency: 'Periodicidad del servicio. En el cálculo rápido, por defecto se deja en "Única" para simplificar la estimación.',
  rapidoDurationMonths: 'Cantidad de meses del proyecto. Junto con la frecuencia define la cantidad de ciclos de cobro.',

  // --- Configuración: Escalas de precio ---
  escalaMin: 'Cantidad MÍNIMA de PDV que entra en este rango (el valor es incluido). Por ejemplo, si el mínimo es 11, un cliente con 11 PDV ya entra en esta escala.',
  escalaMax: 'Cantidad MÁXIMA de PDV que entra en este rango (el valor es incluido). Si una cotización pide más PDV que el máximo de la ÚLTIMA escala, el sistema muestra "cotización personalizada" y calcula un valor orientativo.',
  escalaProductos: 'Cantidad de productos POR PDV que YA ESTÁN INCLUIDOS en el precio base de ESTA escala puntual. Si el cliente pide más productos por PDV que este número, se cobra el "Recargo por producto adicional" (configurado más abajo) por cada unidad que se pase.',
  escalaPrecio: 'Precio total que se cobra por esta escala completa, por UN ciclo de visita, antes de recargos, margen de ganancia, descuento e IVA. Se muestra y se escribe con separador de miles (ej: 10.000.000).',
  pricingMode: '"Cerrado por escala": todo el rango cobra el mismo precio fijo (ej: 11 y 15 PDV pagan lo mismo). "Progresivo (interpolado)": el precio sube de forma gradual a medida que aumentan los PDV dentro del rango, en vez de saltar de golpe entre una escala y la siguiente.',

  // --- Configuración: Productos ---
  extraProductSurcharge: 'Monto que se cobra POR CADA PRODUCTO adicional (uno por uno, no por lote de 10 ni de 100) que supere la cantidad de "Productos incluidos" de la escala correspondiente. Se multiplica por la cantidad de PDV y se cobra en cada ciclo. Ejemplo: escala con 50 productos incluidos, cliente pide 60 en 10 PDV, recargo Gs. 5.000 → (60-50) × Gs. 5.000 × 10 PDV = Gs. 500.000 por ciclo.',

  // --- Configuración: Zona ---
  surchargeGranAsuncionPercent: 'Porcentaje que se suma sobre el subtotal recurrente (precio base + recargos por ciclo) cuando la zona elegida en la cotización es "Gran Asunción".',
  surchargeInteriorPercent: 'Porcentaje que se suma sobre el subtotal recurrente cuando la zona elegida en la cotización es "Interior". Suele ser mayor que el de Gran Asunción por la distancia.',

  // --- Configuración: Auditores y operación ---
  pdvPerAuditor: 'Cantidad de PDV que puede cubrir 1 solo auditor. Se usa únicamente cuando la cotización tiene el modo de auditores en "Automático": cantidad de auditores = PDV ÷ este número (redondeado siempre hacia arriba).',
  costoTraslado: 'Costo de traslado por CADA auditor, por CADA viaje (se asume 1 viaje por ciclo). Se multiplica por la cantidad de auditores y por la cantidad de ciclos del proyecto. Solo se cobra si en la cotización se marca "Requiere traslado".',
  viaticoPorAuditorPorDia: 'Viático por CADA auditor, por CADA día (se asume 1 día por ciclo). Se multiplica por la cantidad de auditores y de ciclos. Solo se cobra si se marca "Requiere viáticos".',
  alojamientoPorAuditorPorNoche: 'Costo de alojamiento por CADA auditor, por CADA noche (se asume 1 noche por ciclo). Se multiplica por auditores y ciclos. Solo se cobra si se marca "Requiere alojamiento".',
  costoVisitaAdicional: 'Costo por CADA visita adicional a un mismo PDV dentro de un ciclo (la primera visita ya está incluida en el precio base). Se multiplica por la cantidad de PDV. Ejemplo: si se piden 3 visitas por PDV, se cobran 2 visitas adicionales por cada PDV.',

  // --- Configuración: Servicios adicionales (cargo único) ---
  costoEvidenciaFotografica: 'Cargo ÚNICO (no se repite por PDV ni por ciclo) que se suma si la cotización marca "Evidencia fotográfica".',
  costoInformeFinal: 'Cargo único que se suma si la cotización marca "Informe final". No se multiplica por PDV ni por ciclos.',
  costoDashboard: 'Cargo único que se suma si la cotización marca "Dashboard de resultados". No se multiplica por PDV ni por ciclos.',
  costoPresentacion: 'Cargo único que se suma si la cotización marca "Presentación de resultados". No se multiplica por PDV ni por ciclos.',

  // --- Configuración: Comercial ---
  margenComercialPercent: 'Porcentaje de ganancia que se agrega sobre el subtotal de costos (antes del descuento y el IVA). Es la utilidad de la empresa: se muestra en el desglose interno y en el PDF interno, pero NUNCA en la versión para el cliente.',
  ivaPercent: 'Porcentaje de IVA que se aplica sobre el subtotal final, después de aplicar el descuento.',
  descuentoMaximoPercent: 'Porcentaje máximo de descuento que se puede aplicar en una cotización. Si en "Nueva cotización" se ingresa un descuento mayor a este valor, el sistema lo recorta automáticamente.',

  // --- Configuración: Mano de obra (horas hombre) ---
  costoPorHoraHombre: 'Costo bruto (sin cargas sociales) de UNA hora de trabajo de un auditor. Este valor se combina con el Aguinaldo y el IPS patronal para obtener el costo REAL de la hora trabajada.',
  horasPorVisitaPdv: 'Cantidad de horas que un auditor dedica, en promedio, a UNA visita a UN PDV. Se multiplica por la cantidad total de visitas del proyecto (PDV × visitas × ciclos) para obtener las horas-hombre totales.',
  aguinaldoPercent: 'Porcentaje que representa el aguinaldo (13er sueldo) sobre el costo de la hora hombre. Por ley equivale a 1/12 del salario, es decir, aproximadamente 8.33%. Se suma al costo por hora para reflejar el costo laboral real.',
  ipsPatronalPercent: 'Porcentaje de aporte patronal al IPS (Instituto de Previsión Social) sobre el costo de la hora hombre. Se suma al costo por hora, junto con el aguinaldo, para calcular el costo real de la mano de obra que se incluye en cada cotización.',

  // --- Configuración: Mystery Shopper — Trabajo de campo ---
  msTrasladoPorVisitaHoras: 'Horas que un mystery shopper dedica a trasladarse (ida y vuelta) entre puntos, por cada visita presencial. Junto con "Espera + interacción" y "Carga de informe" forman las horas totales por visita.',
  msEsperaInteraccionHoras: 'Horas reales que el mystery shopper pasa dentro de la sucursal: espera en fila + interacción con el asesor.',
  msCargaInformeHoras: 'Horas que toma cargar el checklist, las fotos y las notas de evidencia después de cada visita presencial.',
  msJornadaEfectivaHorasDia: 'Cantidad de horas efectivas de trabajo de campo que tiene un mystery shopper por día, descontando almuerzo y tiempos muertos. Se usa para calcular cuántas visitas puede hacer una persona por día y cuántos shoppers se necesitan para cumplir el plazo deseado.',

  // --- Configuración: Mystery Shopper — Canales remotos ---
  msTiempoGestionInteraccionHoras: 'Horas que toma gestionar UNA interacción por canal remoto (WhatsApp, Redes o Web): contacto + seguimiento + registro. No incluye el tiempo de espera de la respuesta de la aseguradora.',

  // --- Configuración: Mystery Shopper — Coordinación y análisis ---
  msHorasDisenoGuion: 'Horas dedicadas a diseñar el guion de la interacción y hacer el briefing a los mystery shoppers. Es una tarea única del proyecto, no se repite por visita ni por interacción.',
  msHorasAnalisisInforme: 'Horas dedicadas a consolidar los resultados, armar la matriz comparativa y redactar el informe ejecutivo final. Es una tarea única del proyecto.',

  // --- Configuración: Mystery Shopper — Costos unitarios ---
  msCostoHoraShopper: 'Costo por hora de trabajo de CADA mystery shopper/relevador (tanto para las visitas presenciales como para la gestión de canales remotos). No incluye cargas sociales adicionales.',
  msCostoHoraAnalista: 'Costo por hora de trabajo del analista/coordinador que diseña el guion y arma el informe final. Suele ser un valor más alto que el del mystery shopper, por tratarse de un perfil de análisis.',
  msViaticoPorVisita: 'Costo de movilidad (viaje corto en auto/taxi dentro de Asunción, ida y vuelta) por CADA visita presencial. No incluye alojamiento ni comida.',
};

let currentPopoverEl = null;

function closeInfoPopover() {
  if (currentPopoverEl) {
    if (currentPopoverEl._icon) currentPopoverEl._icon.classList.remove('info-icon-active');
    currentPopoverEl.remove();
    currentPopoverEl = null;
  }
}

function abrirInfoPopover(icon) {
  const key = icon.getAttribute('data-info');
  const texto = INFO_TEXTS[key] || 'No hay información adicional para este campo.';

  const pop = document.createElement('div');
  pop.className = 'info-popover';
  pop.textContent = texto;
  document.body.appendChild(pop);

  const rect = icon.getBoundingClientRect();
  const popWidth = Math.min(300, window.innerWidth - 32);
  let left = rect.left;
  if (left + popWidth > window.innerWidth - 16) left = window.innerWidth - popWidth - 16;
  if (left < 16) left = 16;

  // Medir alto real del popover para decidir si va arriba o abajo del icono
  const popHeight = pop.getBoundingClientRect().height;
  let top = rect.bottom + 10;
  if (top + popHeight > window.innerHeight - 16) {
    top = rect.top - popHeight - 10;
    pop.classList.add('popover-arrow-bottom');
  }
  if (top < 8) top = 8;

  pop.style.width = popWidth + 'px';
  pop.style.left = left + 'px';
  pop.style.top = top + 'px';

  icon.classList.add('info-icon-active');
  pop._icon = icon;
  currentPopoverEl = pop;
}

function initInfoTooltips() {
  document.body.addEventListener('click', (e) => {
    const icon = e.target.closest('.info-icon');
    if (icon) {
      e.preventDefault();
      e.stopPropagation();
      const wasThisOpen = icon.classList.contains('info-icon-active');
      closeInfoPopover();
      if (!wasThisOpen) abrirInfoPopover(icon);
      return;
    }
    if (e.target.closest('.info-popover')) return; // clic dentro del popover no lo cierra
    closeInfoPopover();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeInfoPopover();
  });

  window.addEventListener('scroll', closeInfoPopover, true);
  window.addEventListener('resize', closeInfoPopover);
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

  document.getElementById('serviceType').addEventListener('change', (e) => {
    actualizarCamposPorTipoServicio(e.target.value);
  });

  document.getElementById('zone').addEventListener('change', (e) => {
    const showDept = e.target.value === 'interior' || e.target.value === 'granAsuncion';
    const showSplit = e.target.value === 'combinada';
    document.getElementById('departmentWrapper').style.display = showDept ? 'block' : 'none';
    document.getElementById('zoneSplitWrapper').style.display = showSplit ? 'block' : 'none';
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
      document.getElementById('departmentWrapper').style.display = 'none';
      document.getElementById('zoneSplitWrapper').style.display = 'none';
      actualizarCamposPorTipoServicio('auditoria');
      attachMilesFormatting(document.getElementById('extraCostManual'));
      APP_STATE.editingQuoteId = null;
      APP_STATE.lastResult = null;
    }
  });
}

/**
 * Muestra u oculta los bloques de campos del formulario de cotización según
 * el tipo de servicio elegido (Auditoría en PDV o Mystery Shopper), ya que
 * cada servicio pide datos distintos.
 */
function actualizarCamposPorTipoServicio(tipo) {
  const esMS = tipo === 'mysteryShopper';
  document.getElementById('fieldsetAuditoria').style.display = esMS ? 'none' : '';
  document.getElementById('fieldsetServiciosAdicionales').style.display = esMS ? 'none' : '';
  document.getElementById('fieldsetMysteryShopper').style.display = esMS ? '' : 'none';
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
    pdvAsuncion: f.pdvAsuncion.value,
    pdvGranAsuncion: f.pdvGranAsuncion.value,
    pdvInterior: f.pdvInterior.value,
    auditorsMode: f.auditorsMode.value,
    auditorsCount: f.auditorsCount.value,

    msAseguradorasCount: f.msAseguradorasCount.value,
    msSucursalesPresencial: f.msSucursalesPresencial.value,
    msCanalesRemotos: f.msCanalesRemotos.value,
    msRondas: f.msRondas.value,
    msPlazoDeseadoDias: f.msPlazoDeseadoDias.value,

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

/**
 * Construye el HTML de "Alcance del servicio" + "Desglose del cálculo" +
 * tarjetas de estadísticas para una cotización de Auditoría en PDV.
 */
function construirCuerpoResultadoAuditoria(resultado, config) {
  const { inputs, desglose, ciclos, totalProductos, totalVisitas, costoPromedioPorPdv, costoPromedioPorVisita, costoMensualEstimado } = resultado;

  const serviciosAdicionales = [];
  if (inputs.requiresTraslado) serviciosAdicionales.push('Traslado');
  if (inputs.requiresAlojamiento) serviciosAdicionales.push('Alojamiento');
  if (inputs.requiresViaticos) serviciosAdicionales.push('Viáticos');
  if (inputs.requiresFotografia) serviciosAdicionales.push('Evidencia fotográfica');
  if (inputs.requiresInforme) serviciosAdicionales.push('Informe final');
  if (inputs.requiresDashboard) serviciosAdicionales.push('Dashboard de resultados');
  if (inputs.requiresPresentacion) serviciosAdicionales.push('Presentación de resultados');

  const zonaLabel = ZONA_LABELS[inputs.zone] || inputs.zone;
  const frecuenciaLabel = { unica: 'Única', semanal: 'Semanal', quincenal: 'Quincenal', mensual: 'Mensual' }[inputs.frequency] || inputs.frequency;
  const detalleZonaCombinada = inputs.zone === 'combinada'
    ? ` (Asunción: ${inputs.pdvAsuncion || 0} · Gran Asunción: ${inputs.pdvGranAsuncion || 0} · Interior: ${inputs.pdvInterior || 0})`
    : '';

  return `
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
            <dt>Zona</dt><dd>${zonaLabel}${inputs.department ? ' - ' + inputs.department : ''}${detalleZonaCombinada}</dd>
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
            <tr><td>Recargo de zona (${desglose.porcentajeZona.toFixed(2)}%)</td><td>${formatearMoneda(desglose.recargoZona, config.moneda)}</td></tr>
            <tr><td>Traslado</td><td>${formatearMoneda(desglose.costoTraslado, config.moneda)}</td></tr>
            <tr><td>Viáticos</td><td>${formatearMoneda(desglose.costoViaticos, config.moneda)}</td></tr>
            <tr><td>Alojamiento</td><td>${formatearMoneda(desglose.costoAlojamiento, config.moneda)}</td></tr>
            <tr><td>Evidencia fotográfica</td><td>${formatearMoneda(desglose.costoFotografia, config.moneda)}</td></tr>
            <tr><td>Informe final</td><td>${formatearMoneda(desglose.costoInforme, config.moneda)}</td></tr>
            <tr><td>Dashboard</td><td>${formatearMoneda(desglose.costoDashboard, config.moneda)}</td></tr>
            <tr><td>Presentación de resultados</td><td>${formatearMoneda(desglose.costoPresentacion, config.moneda)}</td></tr>
            <tr><td>Mano de obra (${desglose.horasHombreTotales.toLocaleString('es-PY')} horas c/cargas sociales)</td><td>${formatearMoneda(desglose.costoManoDeObra, config.moneda)}</td></tr>
            <tr><td>Costo adicional manual ${inputs.extraCostReason ? '(' + inputs.extraCostReason + ')' : ''}</td><td>${formatearMoneda(desglose.costoAdicionalManual, config.moneda)}</td></tr>
            <tr class="subtotal-row"><td>Subtotal antes de margen</td><td>${formatearMoneda(desglose.subtotalAntesMargen, config.moneda)}</td></tr>
            <tr><td>Margen de ganancia (${desglose.margenPercent}%)</td><td>${formatearMoneda(desglose.margenComercial, config.moneda)}</td></tr>
            <tr class="subtotal-row"><td>Subtotal con margen</td><td>${formatearMoneda(desglose.subtotalConMargen, config.moneda)}</td></tr>
            <tr class="discount-row"><td>Descuento (${desglose.descuentoPercent}%)</td><td>- ${formatearMoneda(desglose.montoDescuento, config.moneda)}</td></tr>
            <tr class="subtotal-row"><td>Subtotal</td><td>${formatearMoneda(desglose.subtotalConDescuento, config.moneda)}</td></tr>
            <tr><td>IVA (${desglose.ivaPercent}%)</td><td>${formatearMoneda(desglose.montoIva, config.moneda)}</td></tr>
            <tr class="total-row"><td>TOTAL ESTIMADO</td><td>${formatearMoneda(desglose.total, config.moneda)}</td></tr>
            <tr><td>Costo mensual estimado (promedio)</td><td>${formatearMoneda(costoMensualEstimado, config.moneda)}</td></tr>
          </tbody>
        </table>
      </div>

      <div class="result-grid">
        <div class="stat-card"><span class="stat-label">Costo mensual estimado</span><span class="stat-value">${formatearMoneda(costoMensualEstimado, config.moneda)}</span></div>
        <div class="stat-card"><span class="stat-label">Costo promedio por PDV</span><span class="stat-value">${formatearMoneda(costoPromedioPorPdv, config.moneda)}</span></div>
        <div class="stat-card"><span class="stat-label">Costo promedio por visita</span><span class="stat-value">${formatearMoneda(costoPromedioPorVisita, config.moneda)}</span></div>
        <div class="stat-card stat-card-margin"><span class="stat-label">Margen de ganancia (${desglose.margenPercent}%)</span><span class="stat-value">${formatearMoneda(desglose.margenComercial, config.moneda)}</span></div>
      </div>
  `;
}

/**
 * Construye el HTML de "Alcance del servicio" + "Desglose del cálculo" +
 * tarjetas de estadísticas para una cotización de Mystery Shopper.
 */
function construirCuerpoResultadoMysteryShopper(resultado, config) {
  const { inputs, desglose, totalVisitas, totalInteracciones, costoPromedioPorSucursal, costoPromedioPorAseguradora } = resultado;

  return `
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
            <dt>Aseguradoras a monitorear</dt><dd>${inputs.msAseguradorasCount || 0}</dd>
            <dt>Sucursales a visitar (presencial)</dt><dd>${inputs.msSucursalesPresencial || 0}</dd>
            <dt>Canales remotos por aseguradora</dt><dd>${inputs.msCanalesRemotos || 0}</dd>
            <dt>Rondas de relevamiento</dt><dd>${inputs.msRondas || 1}</dd>
            <dt>Plazo deseado</dt><dd>${inputs.msPlazoDeseadoDias || 0} días hábiles</dd>
            <dt>Visitas presenciales totales</dt><dd>${totalVisitas}</dd>
            <dt>Interacciones remotas totales</dt><dd>${totalInteracciones}</dd>
            <dt>Mystery shoppers necesarios</dt><dd>${desglose.shoppersNecesarios}</dd>
          </dl>
        </div>
      </div>

      <div class="result-block">
        <h3>Desglose del cálculo (uso interno)</h3>
        <table class="breakdown-table">
          <tbody>
            <tr><td colspan="2"><strong>A. Trabajo de campo presencial</strong></td></tr>
            <tr><td>Horas por visita (traslado + espera/atención + carga informe)</td><td>${desglose.horasPorVisita.toLocaleString('es-PY')} horas</td></tr>
            <tr><td>Visitas totales (sucursales × rondas)</td><td>${desglose.visitasTotales}</td></tr>
            <tr><td>Horas-hombre totales de campo</td><td>${desglose.horasHombreCampo.toLocaleString('es-PY')} horas</td></tr>
            <tr><td>Visitas posibles por día, por shopper</td><td>${desglose.visitasPorDiaPorShopper}</td></tr>
            <tr><td>Días necesarios con 1 sola persona</td><td>${desglose.diasNecesariosConUnaPersona}</td></tr>
            <tr><td>Mystery shoppers necesarios para el plazo deseado</td><td>${desglose.shoppersNecesarios}</td></tr>
            <tr><td>Costo mano de obra — campo presencial</td><td>${formatearMoneda(desglose.costoCampoManoObra, config.moneda)}</td></tr>

            <tr><td colspan="2"><strong>B. Viáticos</strong></td></tr>
            <tr><td>Viáticos totales (movilidad, solo Asunción)</td><td>${formatearMoneda(desglose.viaticosTotales, config.moneda)}</td></tr>

            <tr><td colspan="2"><strong>C. Canales remotos (WhatsApp / Redes / Web)</strong></td></tr>
            <tr><td>Interacciones totales (aseguradoras × canales × rondas)</td><td>${desglose.interaccionesTotales}</td></tr>
            <tr><td>Horas-hombre totales — gestión remota</td><td>${desglose.horasHombreRemoto.toLocaleString('es-PY')} horas</td></tr>
            <tr><td>Costo mano de obra — canales remotos</td><td>${formatearMoneda(desglose.costoRemotoManoObra, config.moneda)}</td></tr>

            <tr><td colspan="2"><strong>D. Coordinación y análisis</strong></td></tr>
            <tr><td>Horas totales (diseño de guion + análisis e informe)</td><td>${desglose.horasCoordinacion.toLocaleString('es-PY')} horas</td></tr>
            <tr><td>Costo coordinación y análisis</td><td>${formatearMoneda(desglose.costoCoordinacion, config.moneda)}</td></tr>

            <tr><td colspan="2"><strong>E. Resumen y total</strong></td></tr>
            <tr><td>Subtotal mano de obra (campo + remoto + coordinación)</td><td>${formatearMoneda(desglose.subtotalManoObra, config.moneda)}</td></tr>
            <tr><td>Subtotal general (mano de obra + viáticos)</td><td>${formatearMoneda(desglose.subtotalGeneral, config.moneda)}</td></tr>
            <tr><td>Costo adicional manual ${inputs.extraCostReason ? '(' + inputs.extraCostReason + ')' : ''}</td><td>${formatearMoneda(desglose.costoAdicionalManual, config.moneda)}</td></tr>
            <tr class="subtotal-row"><td>Subtotal antes de margen</td><td>${formatearMoneda(desglose.subtotalAntesMargen, config.moneda)}</td></tr>
            <tr><td>Margen de ganancia (${desglose.margenPercent}%)</td><td>${formatearMoneda(desglose.margenComercial, config.moneda)}</td></tr>
            <tr class="subtotal-row"><td>Subtotal con margen</td><td>${formatearMoneda(desglose.subtotalConMargen, config.moneda)}</td></tr>
            <tr class="discount-row"><td>Descuento (${desglose.descuentoPercent}%)</td><td>- ${formatearMoneda(desglose.montoDescuento, config.moneda)}</td></tr>
            <tr class="subtotal-row"><td>Subtotal</td><td>${formatearMoneda(desglose.subtotalConDescuento, config.moneda)}</td></tr>
            <tr><td>IVA (${desglose.ivaPercent}%)</td><td>${formatearMoneda(desglose.montoIva, config.moneda)}</td></tr>
            <tr class="total-row"><td>TOTAL PROPUESTA</td><td>${formatearMoneda(desglose.total, config.moneda)}</td></tr>
          </tbody>
        </table>
      </div>

      <div class="result-grid">
        <div class="stat-card"><span class="stat-label">Dotación de campo (shoppers)</span><span class="stat-value">${desglose.shoppersNecesarios} persona(s)</span></div>
        <div class="stat-card"><span class="stat-label">Costo promedio por sucursal</span><span class="stat-value">${formatearMoneda(costoPromedioPorSucursal, config.moneda)}</span></div>
        <div class="stat-card"><span class="stat-label">Costo promedio por aseguradora</span><span class="stat-value">${formatearMoneda(costoPromedioPorAseguradora, config.moneda)}</span></div>
        <div class="stat-card stat-card-margin"><span class="stat-label">Margen de ganancia (${desglose.margenPercent}%)</span><span class="stat-value">${formatearMoneda(desglose.margenComercial, config.moneda)}</span></div>
      </div>
  `;
}

function renderResultado(resultado, config) {
  const { inputs, desglose, isCustom, costoMensualEstimado } = resultado;
  const wrapper = document.getElementById('resultadoWrapper');
  const esMS = esMysteryShopper(inputs);

  const numeroCotizacion = APP_STATE.editingQuoteId
    ? (getHistory().find((q) => q.id === APP_STATE.editingQuoteId)?.numero || getNextQuoteNumber())
    : getNextQuoteNumberPreview();

  const cuerpo = esMS
    ? construirCuerpoResultadoMysteryShopper(resultado, config)
    : construirCuerpoResultadoAuditoria(resultado, config);

  wrapper.innerHTML = `
    <div class="card result-card">
      <div class="result-header">
        <div>
          <h2>Cotización ${numeroCotizacion}</h2>
          <p class="muted">${inputs.clientName} · ${SERVICE_TYPE_LABELS[inputs.serviceType] || inputs.serviceType} · ${inputs.projectName || 'Sin nombre de proyecto'}</p>
        </div>
        <div class="total-badge">
          <span class="total-label">Total estimado</span>
          <span class="total-value">${formatearMoneda(desglose.total, config.moneda)}</span>
          ${esMS ? '' : `<span class="total-secondary">≈ ${formatearMoneda(costoMensualEstimado, config.moneda)} / mes</span>`}
        </div>
      </div>

      ${isCustom ? `<div class="alert alert-warning">Este servicio requiere una cotización personalizada. El cálculo mostrado es <strong>estimado y está sujeto a revisión</strong>.</div>` : ''}

      ${cuerpo}

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
  const esMS = esMysteryShopper(inputs);

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

  const alcance = esMS
    ? `${inputs.msAseguradorasCount || 0} aseg. · ${inputs.msSucursalesPresencial || 0} suc.`
    : `${inputs.pdvCount} PDV`;

  const record = {
    id: existing ? existing.id : cryptoId(),
    numero,
    cliente: inputs.clientName,
    fecha: inputs.quoteDate,
    servicio: inputs.serviceType,
    pdv: alcance,
    zona: esMS ? 'asuncion' : inputs.zone,
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
    const showSplit = e.target.value === 'combinada';
    document.getElementById('rapidoDepartmentWrapper').style.display = showDept ? 'block' : 'none';
    document.getElementById('rapidoZoneSplitWrapper').style.display = showSplit ? 'block' : 'none';
  });

  document.getElementById('btnLimpiarRapido').addEventListener('click', () => {
    document.getElementById('formRapido').reset();
    document.getElementById('rapidoDepartmentWrapper').style.display = 'none';
    document.getElementById('rapidoZoneSplitWrapper').style.display = 'none';
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
    pdvAsuncion: document.getElementById('rapidoPdvAsuncion').value,
    pdvGranAsuncion: document.getElementById('rapidoPdvGranAsuncion').value,
    pdvInterior: document.getElementById('rapidoPdvInterior').value,
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
  if (inputs.zone === 'combinada') {
    const suma = (Number(inputs.pdvAsuncion) || 0) + (Number(inputs.pdvGranAsuncion) || 0) + (Number(inputs.pdvInterior) || 0);
    if (suma !== pdvCount) {
      alert(`La suma de PDV por zona (${suma}) debe ser igual a la cantidad total de PDV (${pdvCount}).`);
      return;
    }
  }
  const config = getConfig();
  const resultado = calcularCotizacion(inputs, config);
  renderResultadoRapido(resultado, config, inputs);
}

function renderResultadoRapido(resultado, config, inputs) {
  const { desglose, isCustom, costoPromedioPorPdv, costoMensualEstimado } = resultado;
  const wrapper = document.getElementById('resultadoRapidoWrapper');
  const zonaLabel = ZONA_LABELS[inputs.zone] || inputs.zone;

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
          <span class="total-secondary">≈ ${formatearMoneda(costoMensualEstimado, config.moneda)} / mes</span>
        </div>
      </div>

      <div class="result-grid">
        <div class="stat-card"><span class="stat-label">Precio base</span><span class="stat-value">${formatearMoneda(desglose.precioBaseCiclo, config.moneda)}</span></div>
        <div class="stat-card"><span class="stat-label">Costo mensual estimado</span><span class="stat-value">${formatearMoneda(costoMensualEstimado, config.moneda)}</span></div>
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
  document.getElementById('zoneSplitWrapper').style.display =
    inputs.zone === 'combinada' ? 'block' : 'none';
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
  f.horasPorVisitaPdv.value = config.horasPorVisitaPdv;
  f.aguinaldoPercent.value = config.aguinaldoPercent;
  f.ipsPatronalPercent.value = config.ipsPatronalPercent;
  f.msTrasladoPorVisitaHoras.value = config.msTrasladoPorVisitaHoras;
  f.msEsperaInteraccionHoras.value = config.msEsperaInteraccionHoras;
  f.msCargaInformeHoras.value = config.msCargaInformeHoras;
  f.msJornadaEfectivaHorasDia.value = config.msJornadaEfectivaHorasDia;
  f.msTiempoGestionInteraccionHoras.value = config.msTiempoGestionInteraccionHoras;
  f.msHorasDisenoGuion.value = config.msHorasDisenoGuion;
  f.msHorasAnalisisInforme.value = config.msHorasAnalisisInforme;
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
    horasPorVisitaPdv: Number(f.horasPorVisitaPdv.value),
    aguinaldoPercent: Number(f.aguinaldoPercent.value),
    ipsPatronalPercent: Number(f.ipsPatronalPercent.value),
    msTrasladoPorVisitaHoras: Number(f.msTrasladoPorVisitaHoras.value),
    msEsperaInteraccionHoras: Number(f.msEsperaInteraccionHoras.value),
    msCargaInformeHoras: Number(f.msCargaInformeHoras.value),
    msJornadaEfectivaHorasDia: Number(f.msJornadaEfectivaHorasDia.value),
    msTiempoGestionInteraccionHoras: Number(f.msTiempoGestionInteraccionHoras.value),
    msHorasDisenoGuion: Number(f.msHorasDisenoGuion.value),
    msHorasAnalisisInforme: Number(f.msHorasAnalisisInforme.value),
  };

  CAMPOS_MONEDA_CONFIG.forEach((campo) => {
    nuevaConfig[campo] = parseMilesValue(f[campo].value);
  });

  const camposNumericos = [
    ...CAMPOS_MONEDA_CONFIG, 'surchargeGranAsuncionPercent',
    'surchargeInteriorPercent', 'pdvPerAuditor', 'margenComercialPercent',
    'ivaPercent', 'descuentoMaximoPercent', 'horasPorVisitaPdv',
    'aguinaldoPercent', 'ipsPatronalPercent', 'msTrasladoPorVisitaHoras',
    'msEsperaInteraccionHoras', 'msCargaInformeHoras', 'msJornadaEfectivaHorasDia',
    'msTiempoGestionInteraccionHoras', 'msHorasDisenoGuion', 'msHorasAnalisisInforme',
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
  const zonaLabel = ZONA_LABELS;

  if (filtrado.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="muted">No hay cotizaciones que coincidan con la búsqueda.</td></tr>';
    return;
  }

  tbody.innerHTML = filtrado.slice().reverse().map((q) => `
    <tr>
      <td>${q.numero}</td>
      <td>${q.cliente}</td>
      <td>${SERVICE_TYPE_LABELS[q.servicio] || SERVICE_TYPE_LABELS.auditoria}</td>
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
  actualizarCamposPorTipoServicio(inputs.serviceType === 'mysteryShopper' ? 'mysteryShopper' : 'auditoria');
  f.serviceType.value = inputs.serviceType === 'mysteryShopper' ? 'mysteryShopper' : 'auditoria';
  document.getElementById('departmentWrapper').style.display =
    (inputs.zone === 'interior' || inputs.zone === 'granAsuncion') ? 'block' : 'none';
  document.getElementById('zoneSplitWrapper').style.display =
    inputs.zone === 'combinada' ? 'block' : 'none';
  document.getElementById('auditorsCountWrapper').style.display =
    inputs.auditorsMode === 'manual' ? 'block' : 'none';
  attachMilesFormatting(document.getElementById('extraCostManual'));

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
  const { inputs } = resultado;
  if (esMysteryShopper(inputs)) {
    return construirHtmlPreviewMysteryShopper(resultado, config, numero, tipo);
  }
  return construirHtmlPreviewAuditoria(resultado, config, numero, tipo);
}

function construirHtmlPreviewAuditoria(resultado, config, numero, tipo) {
  const { inputs, desglose, ciclos, totalProductos, totalVisitas, costoMensualEstimado } = resultado;
  const zonaLabel = ZONA_LABELS[inputs.zone] || inputs.zone;
  const detalleZonaCombinada = inputs.zone === 'combinada'
    ? ` (Asunción: ${inputs.pdvAsuncion || 0} · Gran Asunción: ${inputs.pdvGranAsuncion || 0} · Interior: ${inputs.pdvInterior || 0})`
    : '';

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
          <tr><td>Tipo de servicio</td><td>${SERVICE_TYPE_LABELS[inputs.serviceType] || inputs.serviceType}</td></tr>
          <tr><td>Cantidad de PDV</td><td>${inputs.pdvCount}</td></tr>
          <tr><td>Productos por PDV</td><td>${inputs.productsPerPdv}</td></tr>
          <tr><td>Total de productos a auditar</td><td>${totalProductos.toLocaleString('es-PY')}</td></tr>
          <tr><td>Zona</td><td>${zonaLabel}${inputs.department ? ' - ' + inputs.department : ''}${detalleZonaCombinada}</td></tr>
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
          <tr><td>Costo mensual estimado (promedio)</td><td>${formatearMoneda(costoMensualEstimado, config.moneda)}</td></tr>
        </tbody>
      </table>

      <p class="muted" style="margin-top:16px;font-size:12px;">
        Cotización estimativa y sujeta a validación comercial y operativa. El precio final puede variar según el alcance definitivo,
        ubicación de los puntos de venta y requerimientos adicionales del cliente.
      </p>
    </div>
  `;
}

function construirHtmlPreviewMysteryShopper(resultado, config, numero, tipo) {
  const { inputs, desglose, totalVisitas, totalInteracciones } = resultado;

  const filasInternas = tipo === 'interno' ? `
    <tr><td>Margen de ganancia (${desglose.margenPercent}%)</td><td>${formatearMoneda(desglose.margenComercial, config.moneda)}</td></tr>
  ` : '';

  return `
    <div class="preview-doc">
      <h2>Cotización de Servicios de Mystery Shopper</h2>
      <p class="muted">N° ${numero} · Fecha: ${inputs.quoteDate}${inputs.validity ? ' · Vigencia: ' + inputs.validity + ' días' : ''}</p>
      <hr>
      <h3>Cliente</h3>
      <p>${inputs.clientName}${inputs.contactName ? ' — Contacto: ' + inputs.contactName : ''}</p>
      ${inputs.projectName ? `<p>Proyecto: ${inputs.projectName}</p>` : ''}

      <h3>Alcance del servicio</h3>
      <table class="breakdown-table">
        <tbody>
          <tr><td>Tipo de servicio</td><td>${SERVICE_TYPE_LABELS[inputs.serviceType] || inputs.serviceType}</td></tr>
          <tr><td>Aseguradoras a monitorear</td><td>${inputs.msAseguradorasCount || 0}</td></tr>
          <tr><td>Sucursales a visitar (presencial)</td><td>${inputs.msSucursalesPresencial || 0}</td></tr>
          <tr><td>Canales remotos por aseguradora</td><td>${inputs.msCanalesRemotos || 0}</td></tr>
          <tr><td>Rondas de relevamiento</td><td>${inputs.msRondas || 1}</td></tr>
          <tr><td>Plazo deseado</td><td>${inputs.msPlazoDeseadoDias || 0} días hábiles</td></tr>
          <tr><td>Visitas presenciales totales</td><td>${totalVisitas}</td></tr>
          <tr><td>Interacciones remotas totales</td><td>${totalInteracciones}</td></tr>
          <tr><td>Mystery shoppers necesarios</td><td>${desglose.shoppersNecesarios}</td></tr>
        </tbody>
      </table>

      <h3>Costos</h3>
      <table class="breakdown-table">
        <tbody>
          <tr><td>Mano de obra — campo presencial</td><td>${formatearMoneda(desglose.costoCampoManoObra, config.moneda)}</td></tr>
          <tr><td>Viáticos de movilidad</td><td>${formatearMoneda(desglose.viaticosTotales, config.moneda)}</td></tr>
          <tr><td>Mano de obra — canales remotos</td><td>${formatearMoneda(desglose.costoRemotoManoObra, config.moneda)}</td></tr>
          <tr><td>Coordinación y análisis</td><td>${formatearMoneda(desglose.costoCoordinacion, config.moneda)}</td></tr>
          ${filasInternas}
          <tr><td>Descuento (${desglose.descuentoPercent}%)</td><td>- ${formatearMoneda(desglose.montoDescuento, config.moneda)}</td></tr>
          <tr><td>IVA (${desglose.ivaPercent}%)</td><td>${formatearMoneda(desglose.montoIva, config.moneda)}</td></tr>
          <tr class="total-row"><td>TOTAL PROPUESTA</td><td>${formatearMoneda(desglose.total, config.moneda)}</td></tr>
        </tbody>
      </table>

      <p class="muted" style="margin-top:16px;font-size:12px;">
        Cotización estimativa y sujeta a validación comercial y operativa. El precio final puede variar según el alcance definitivo
        y requerimientos adicionales del cliente.
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
  const { inputs } = resultado;
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

  const ctx = { doc, margin, lineHeight, pageWidth, addLine, addRow, getY: () => y, setY: (v) => { y = v; } };

  if (esMysteryShopper(inputs)) {
    generarCuerpoPdfMysteryShopper(ctx, resultado, config, numero, tipo);
  } else {
    generarCuerpoPdfAuditoria(ctx, resultado, config, numero, tipo);
  }

  const sufijo = tipo === 'interno' ? 'interno' : 'cliente';
  doc.save(`${numero.replace(/\s.*$/, '')}-${sufijo}.pdf`);
}

function generarCuerpoPdfAuditoria(ctx, resultado, config, numero, tipo) {
  const { addLine, addRow, margin, pageWidth, doc } = ctx;
  const { inputs, desglose, ciclos, totalProductos, totalVisitas, costoMensualEstimado } = resultado;
  let y = ctx.getY();

  const zonaLabel = ZONA_LABELS[inputs.zone] || inputs.zone;
  const detalleZonaCombinada = inputs.zone === 'combinada'
    ? ` (Asu: ${inputs.pdvAsuncion || 0} / G.Asu: ${inputs.pdvGranAsuncion || 0} / Int: ${inputs.pdvInterior || 0})`
    : '';

  addLine('Cotización de Servicios de Auditoría en PDV', { size: 16, bold: true, lh: 24 });
  addLine(`N° ${numero}  ·  Fecha: ${inputs.quoteDate}${inputs.validity ? '  ·  Vigencia: ' + inputs.validity + ' días' : ''}`, { size: 10, lh: 22 });

  addLine('DATOS DEL CLIENTE', { bold: true, size: 12, lh: 18 });
  addRow('Cliente', inputs.clientName);
  if (inputs.contactName) addRow('Contacto', inputs.contactName);
  if (inputs.projectName) addRow('Proyecto', inputs.projectName);
  y = ctx.getY() + 8; ctx.setY(y);

  addLine('ALCANCE DEL SERVICIO', { bold: true, size: 12, lh: 18 });
  addRow('Tipo de servicio', SERVICE_TYPE_LABELS[inputs.serviceType] || inputs.serviceType);
  addRow('Cantidad de PDV', String(inputs.pdvCount));
  addRow('Productos por PDV', String(inputs.productsPerPdv));
  addRow('Total de productos a auditar', totalProductos.toLocaleString('es-PY'));
  addRow('Zona', zonaLabel + (inputs.department ? ' - ' + inputs.department : '') + detalleZonaCombinada);
  addRow('Visitas totales', String(totalVisitas));
  addRow('Duración', `${inputs.durationMonths} mes(es) (${ciclos} ciclos)`);
  addRow('Auditores requeridos', String(desglose.cantidadAuditores));
  y = ctx.getY() + 8; ctx.setY(y);

  addLine('COSTOS', { bold: true, size: 12, lh: 18 });
  addRow('Precio base por ciclo', formatearMoneda(desglose.precioBaseCiclo, config.moneda));
  addRow('Recargo productos adicionales (por ciclo)', formatearMoneda(desglose.recargoProductosCiclo, config.moneda));
  addRow('Recargo visitas adicionales (por ciclo)', formatearMoneda(desglose.recargoVisitasCiclo, config.moneda));
  addRow(`Subtotal recurrente (x${ciclos})`, formatearMoneda(desglose.subtotalRecurrente, config.moneda));
  addRow(`Recargo de zona (${desglose.porcentajeZona.toFixed(2)}%)`, formatearMoneda(desglose.recargoZona, config.moneda));
  addRow('Costos operativos y servicios adicionales', formatearMoneda(desglose.subtotalOperativo, config.moneda));
  addRow('  (incluye mano de obra: ' + desglose.horasHombreTotales.toLocaleString('es-PY') + ' horas)', formatearMoneda(desglose.costoManoDeObra, config.moneda));

  if (tipo === 'interno') {
    addRow(`Margen de ganancia (${desglose.margenPercent}%)`, formatearMoneda(desglose.margenComercial, config.moneda));
  }

  addRow(`Descuento (${desglose.descuentoPercent}%)`, '- ' + formatearMoneda(desglose.montoDescuento, config.moneda));
  addRow(`IVA (${desglose.ivaPercent}%)`, formatearMoneda(desglose.montoIva, config.moneda));

  y = ctx.getY() + 4; ctx.setY(y);
  doc.setDrawColor(200);
  doc.line(margin, y, pageWidth - margin, y);
  y += 18; ctx.setY(y);
  addLine(`TOTAL ESTIMADO: ${formatearMoneda(desglose.total, config.moneda)}`, { bold: true, size: 13, lh: 20 });
  addLine(`Costo mensual estimado (promedio): ${formatearMoneda(costoMensualEstimado, config.moneda)}`, { size: 10, lh: 16 });

  agregarDisclaimerPdf(ctx, 'Cotización estimativa y sujeta a validación comercial y operativa. El precio final puede variar según el alcance definitivo, ubicación de los puntos de venta y requerimientos adicionales del cliente.');
}

function generarCuerpoPdfMysteryShopper(ctx, resultado, config, numero, tipo) {
  const { addLine, addRow, margin, pageWidth, doc } = ctx;
  const { inputs, desglose, totalVisitas, totalInteracciones } = resultado;
  let y;

  addLine('Cotización de Servicios de Mystery Shopper', { size: 16, bold: true, lh: 24 });
  addLine(`N° ${numero}  ·  Fecha: ${inputs.quoteDate}${inputs.validity ? '  ·  Vigencia: ' + inputs.validity + ' días' : ''}`, { size: 10, lh: 22 });

  addLine('DATOS DEL CLIENTE', { bold: true, size: 12, lh: 18 });
  addRow('Cliente', inputs.clientName);
  if (inputs.contactName) addRow('Contacto', inputs.contactName);
  if (inputs.projectName) addRow('Proyecto', inputs.projectName);
  y = ctx.getY() + 8; ctx.setY(y);

  addLine('ALCANCE DEL SERVICIO', { bold: true, size: 12, lh: 18 });
  addRow('Tipo de servicio', SERVICE_TYPE_LABELS[inputs.serviceType] || inputs.serviceType);
  addRow('Aseguradoras a monitorear', String(inputs.msAseguradorasCount || 0));
  addRow('Sucursales a visitar (presencial)', String(inputs.msSucursalesPresencial || 0));
  addRow('Canales remotos por aseguradora', String(inputs.msCanalesRemotos || 0));
  addRow('Rondas de relevamiento', String(inputs.msRondas || 1));
  addRow('Plazo deseado', `${inputs.msPlazoDeseadoDias || 0} días hábiles`);
  addRow('Visitas presenciales totales', String(totalVisitas));
  addRow('Interacciones remotas totales', String(totalInteracciones));
  addRow('Mystery shoppers necesarios', String(desglose.shoppersNecesarios));
  y = ctx.getY() + 8; ctx.setY(y);

  addLine('COSTOS', { bold: true, size: 12, lh: 18 });
  addRow('Mano de obra — campo presencial', formatearMoneda(desglose.costoCampoManoObra, config.moneda));
  addRow('Viáticos de movilidad', formatearMoneda(desglose.viaticosTotales, config.moneda));
  addRow('Mano de obra — canales remotos', formatearMoneda(desglose.costoRemotoManoObra, config.moneda));
  addRow('Coordinación y análisis', formatearMoneda(desglose.costoCoordinacion, config.moneda));

  if (tipo === 'interno') {
    addRow(`Margen de ganancia (${desglose.margenPercent}%)`, formatearMoneda(desglose.margenComercial, config.moneda));
  }

  addRow(`Descuento (${desglose.descuentoPercent}%)`, '- ' + formatearMoneda(desglose.montoDescuento, config.moneda));
  addRow(`IVA (${desglose.ivaPercent}%)`, formatearMoneda(desglose.montoIva, config.moneda));

  y = ctx.getY() + 4; ctx.setY(y);
  doc.setDrawColor(200);
  doc.line(margin, y, pageWidth - margin, y);
  y += 18; ctx.setY(y);
  addLine(`TOTAL PROPUESTA: ${formatearMoneda(desglose.total, config.moneda)}`, { bold: true, size: 13, lh: 20 });

  agregarDisclaimerPdf(ctx, 'Cotización estimativa y sujeta a validación comercial y operativa. El precio final puede variar según el alcance definitivo y requerimientos adicionales del cliente.');
}

function agregarDisclaimerPdf(ctx, texto) {
  const { doc, margin, pageWidth } = ctx;
  let y = ctx.getY() + 10;
  doc.setFontSize(8);
  doc.setFont(undefined, 'italic');
  const disclaimer = doc.splitTextToSize(texto, pageWidth - margin * 2);
  doc.text(disclaimer, margin, y);
}

/* ==========================================================================
   9. INICIALIZACION
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  getConfig(); // asegura que exista configuración en localStorage
  initNavegacion();
  initInfoTooltips();
  initFormularioCotizacion();
  actualizarCamposPorTipoServicio('auditoria');
  initCalculoRapido();
  initConfiguracion();
  initHistorial();
  cambiarVista('nueva');
});
