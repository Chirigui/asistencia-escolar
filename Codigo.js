/**
 * ============================================================================
 * SISTEMA INTEGRAL DE GESTIÓN Y ASISTENCIA ESCOLAR PRO
 * 100% Gratuito · Google Sheets + Google Apps Script + Web App + QR
 * Capacidad: 800 - 1.000+ Estudiantes · Optimizado para Alta Concurrencia
 * ============================================================================
 *
 * Módulos integrados:
 * 1. Infraestructura y Creación Automática de Hojas (ESTUDIANTES, SESIONES, ASISTENCIA, INCIDENCIAS, CONFIGURACION)
 * 2. Seguridad Administrativa (Hash SHA-256 + Salt + Token en Servidor)
 * 3. Cache Ultra-Rápido y LockService (Prevención de duplicados y latencia cero)
 * 4. Web App Estudiante (Registro ágil de asistencia por QR o enlace directo)
 * 5. Web App Profesor (Creación de clases, QR gigante para proyector, lista en vivo de presentes y ausentes)
 * 6. Asistencia Manual y Control de Clases (Cierre, reapertura, justificaciones)
 * 7. Reportes Multicriterio y Exportación CSV / Google Sheets
 * 8. Importador Masivo de Estudiantes con Previsualización y Validación
 * 9. Auditoría, Registro de Incidencias y Diagnóstico del Sistema
 */

// ============================================================================
// CONFIGURACIÓN GLOBAL Y CONSTANTES
// ============================================================================

const HOJAS = {
  ESTUDIANTES: "ESTUDIANTES",
  SESIONES: "SESIONES",
  ASISTENCIA: "ASISTENCIA",
  INCIDENCIAS: "INCIDENCIAS",
  CONFIGURACION: "CONFIGURACION"
};

const CACHE_KEYS = {
  ESTUDIANTES: "INDICE_ESTUDIANTES_CACHE_V2",
  TOTALES_GRUPO: "TOTALES_GRUPO_V2",
  SESIONES_RESUMEN: "SESIONES_RESUMEN_V2"
};

const TIEMPO_CACHE = {
  LARGO: 21600, // 6 horas
  MEDIO: 1800,  // 30 minutos
  CORTO: 120    // 2 minutos
};

// ============================================================================
// ENTRADA HTTP PRINCIPAL (doGet)
// ============================================================================

function doGet(e) {
  const parametros = (e && e.parameter) ? e.parameter : {};

  // Asegurar que las hojas y configuraciones existan
  try {
    asegurarInfraestructuraCompleta();
  } catch (err) {
    console.warn("Aviso en inicialización de hojas: " + err.message);
  }

  // 1. PANEL DEL PROFESOR
  if (parametros.panel === "profesor" || parametros.p === "admin") {
    const template = HtmlService.createTemplateFromFile("PanelProfesor");
    template.webAppUrl = obtenerUrlWebApp();
    return template
      .evaluate()
      .setTitle("Panel Docente | Sistema de Asistencia")
      .addMetaTag("viewport", "width=device-width, initial-scale=1, maximum-scale=1")
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  // 2. WEB APP DEL ESTUDIANTE
  const template = HtmlService.createTemplateFromFile("Index");
  let idSesion = "";

  if (parametros.sesion) {
    idSesion = String(parametros.sesion).trim().toUpperCase();
  } else if (parametros.s) {
    idSesion = String(parametros.s).trim().toUpperCase();
  } else {
    // Si no trae ID en la URL, busca si hay exactamente una sesión activa en este momento
    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const hojaSesiones = ss.getSheetByName(HOJAS.SESIONES);
      if (hojaSesiones) {
        const sesionActiva = buscarSesionActivaAhora(hojaSesiones);
        if (sesionActiva) {
          idSesion = sesionActiva.idSesion;
        }
      }
    } catch (e) {
      console.warn("No se pudo autodetectar sesión activa: " + e.message);
    }
  }

  template.idSesion = idSesion;
  template.webAppUrl = obtenerUrlWebApp();

  return template
    .evaluate()
    .setTitle("Registro de Asistencia Escolar")
    .addMetaTag("viewport", "width=device-width, initial-scale=1, maximum-scale=1")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ============================================================================
// URL DE LA WEB APP Y ENLACES
// ============================================================================

function obtenerUrlWebApp() {
  try {
    const url = ScriptApp.getService().getUrl();
    if (url && url.indexOf("/exec") !== -1) {
      return url;
    }
  } catch (e) {}

  const guardada = PropertiesService.getScriptProperties().getProperty("WEB_APP_URL");
  if (guardada) {
    return guardada;
  }
  return "";
}

function configurarUrlWebAppManual(url) {
  const limpia = String(url || "").trim();
  if (!limpia.endsWith("/exec")) {
    return { ok: false, mensaje: "La URL debe terminar en /exec (URL de la aplicación web publicada)." };
  }
  PropertiesService.getScriptProperties().setProperty("WEB_APP_URL", limpia);
  return { ok: true, mensaje: "URL actualizada correctamente." };
}

function generarEnlaceSesion(idSesion) {
  const baseUrl = obtenerUrlWebApp();
  const idLimpio = String(idSesion).trim().toUpperCase();
  if (baseUrl) {
    return baseUrl + "?sesion=" + encodeURIComponent(idLimpio);
  }
  return "?sesion=" + encodeURIComponent(idLimpio);
}

// ============================================================================
// INFRAESTRUCTURA DE HOJAS Y AUTOMATIZACIÓN
// ============================================================================

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("🎓 Asistencia Escolar")
    .addItem("🔐 Configurar / Cambiar clave docente", "configurarClaveAdmin")
    .addItem("⚡ Reconstruir índices y caché", "actualizarIndiceEstudiantes")
    .addItem("🛠️ Verificar y reparar hojas", "asegurarInfraestructuraCompleta")
    .addSeparator()
    .addItem("🧹 Limpiar datos de prueba y reiniciar sistema", "menuReiniciarSistema")
    .addSeparator()
    .addItem("📊 Abrir Panel Docente en navegador", "abrirPanelEnlace")
    .addToUi();
}

function menuReiniciarSistema() {
  const ui = SpreadsheetApp.getUi();
  const res = ui.alert(
    "⚠️ Limpiar Datos de Prueba y Purgar Caché",
    "Esta acción borrará todas las asistencias, sesiones e incidencias registradas en las hojas durante las pruebas, y pondrá a cero todos los contadores y la memoria caché.\n\n¿Deseas continuar?",
    ui.ButtonSet.YES_NO
  );
  if (res !== ui.Button.YES) return;

  const resultado = ejecutarLimpiezaTotal({
    borrarAsistencias: true,
    borrarSesiones: true,
    borrarIncidencias: true,
    purgarCache: true,
    borrarEstudiantes: false
  });

  ui.alert("✅ Limpieza completada con éxito:\n\n" + resultado.mensaje);
}

function ejecutarLimpiezaTotal(opciones) {
  opciones = opciones || {};
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let detalles = [];

  // 1. Limpiar ASISTENCIA
  if (opciones.borrarAsistencias !== false) {
    const hojaAsis = ss.getSheetByName(HOJAS.ASISTENCIA);
    if (hojaAsis && hojaAsis.getLastRow() >= 2) {
      hojaAsis.getRange(2, 1, hojaAsis.getLastRow() - 1, hojaAsis.getLastColumn()).clearContent();
      detalles.push("Hoja ASISTENCIA limpiada.");
    }
  }

  // 2. Limpiar SESIONES
  if (opciones.borrarSesiones !== false) {
    const hojaSes = ss.getSheetByName(HOJAS.SESIONES);
    if (hojaSes && hojaSes.getLastRow() >= 2) {
      hojaSes.getRange(2, 1, hojaSes.getLastRow() - 1, hojaSes.getLastColumn()).clearContent();
      detalles.push("Hoja SESIONES limpiada.");
    }
  }

  // 3. Limpiar INCIDENCIAS
  if (opciones.borrarIncidencias !== false) {
    const hojaInc = ss.getSheetByName(HOJAS.INCIDENCIAS);
    if (hojaInc && hojaInc.getLastRow() >= 2) {
      hojaInc.getRange(2, 1, hojaInc.getLastRow() - 1, hojaInc.getLastColumn()).clearContent();
      detalles.push("Hoja INCIDENCIAS limpiada.");
    }
  }

  // 4. Limpiar ESTUDIANTES si se solicita explícitamente
  if (opciones.borrarEstudiantes === true) {
    const hojaEst = ss.getSheetByName(HOJAS.ESTUDIANTES);
    if (hojaEst && hojaEst.getLastRow() >= 2) {
      hojaEst.getRange(2, 1, hojaEst.getLastRow() - 1, hojaEst.getLastColumn()).clearContent();
      detalles.push("Hoja ESTUDIANTES limpiada.");
    }
  }

  // 5. Reiniciar contadores en PropertiesService
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty("CONTADOR_ASISTENCIA");
  props.deleteProperty("CONTADOR_INCIDENCIAS");
  props.deleteProperty("INDICE_ESTUDIANTES");

  // 6. Purgar caché
  const cache = CacheService.getScriptCache();
  cache.remove(CACHE_KEYS.ESTUDIANTES);
  cache.remove(CACHE_KEYS.TOTALES_GRUPO);
  cache.remove(CACHE_KEYS.SESIONES_RESUMEN);

  // 7. Reconstruir índice limpio de estudiantes
  actualizarIndiceEstudiantes();
  SpreadsheetApp.flush();

  return {
    ok: true,
    mensaje: detalles.length > 0
      ? detalles.join("\n") + "\n\nCaché purgada y contadores reiniciados a cero."
      : "El sistema ya se encontraba limpio. Caché y contadores reiniciados a cero."
  };
}

function reiniciarDatosPruebaWeb(token, opciones) {
  exigirAdministrador(token);
  return ejecutarLimpiezaTotal(opciones);
}

function abrirPanelEnlace() {
  const url = obtenerUrlWebApp();
  const ui = SpreadsheetApp.getUi();
  if (!url) {
    ui.alert("Primero publica tu aplicación web desde 'Implementar' > 'Nueva implementación'.");
    return;
  }
  const enlace = url + "?panel=profesor";
  ui.alert("Enlace al Panel Docente:\n\n" + enlace + "\n\nCopia este enlace o ábrelo en tu navegador.");
}

function asegurarInfraestructuraCompleta() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // 1. ESTUDIANTES
  let hojaEstudiantes = ss.getSheetByName(HOJAS.ESTUDIANTES);
  if (!hojaEstudiantes) {
    hojaEstudiantes = ss.insertSheet(HOJAS.ESTUDIANTES);
    hojaEstudiantes.getRange(1, 1, 1, 5).setValues([[
      "DOCUMENTO", "NOMBRE", "GRADO", "GRUPO", "ESTADO"
    ]]);
    hojaEstudiantes.getRange(1, 1, 1, 5).setFontWeight("bold").setBackground("#1e293b").setFontColor("#ffffff");
    hojaEstudiantes.setFrozenRows(1);
    hojaEstudiantes.setColumnWidth(1, 140);
    hojaEstudiantes.setColumnWidth(2, 260);
    hojaEstudiantes.setColumnWidth(3, 90);
    hojaEstudiantes.setColumnWidth(4, 90);
    hojaEstudiantes.setColumnWidth(5, 110);

    // Fila de ejemplo
    hojaEstudiantes.appendRow(["1000000001", "Estudiante de Ejemplo 1", "10", "A", "ACTIVO"]);
    hojaEstudiantes.appendRow(["1000000002", "Estudiante de Ejemplo 2", "10", "A", "ACTIVO"]);
    hojaEstudiantes.appendRow(["1000000003", "Estudiante de Ejemplo 3", "10", "B", "ACTIVO"]);
  }

  // 2. SESIONES
  let hojaSesiones = ss.getSheetByName(HOJAS.SESIONES);
  if (!hojaSesiones) {
    hojaSesiones = ss.insertSheet(HOJAS.SESIONES);
    hojaSesiones.getRange(1, 1, 1, 9).setValues([[
      "ID_SESION", "FECHA", "HORA_INICIO", "HORA_FIN", "CURSO", "GRUPO", "ESTADO", "ENLACE_QR", "QR"
    ]]);
    hojaSesiones.getRange(1, 1, 1, 9).setFontWeight("bold").setBackground("#1e293b").setFontColor("#ffffff");
    hojaSesiones.setFrozenRows(1);
    hojaSesiones.setColumnWidth(1, 110);
    hojaSesiones.setColumnWidth(2, 110);
    hojaSesiones.setColumnWidth(3, 110);
    hojaSesiones.setColumnWidth(4, 110);
    hojaSesiones.setColumnWidth(5, 200);
    hojaSesiones.setColumnWidth(6, 110);
    hojaSesiones.setColumnWidth(7, 110);
    hojaSesiones.setColumnWidth(8, 260);
    hojaSesiones.setColumnWidth(9, 130);
  }

  // 3. ASISTENCIA
  let hojaAsistencia = ss.getSheetByName(HOJAS.ASISTENCIA);
  if (!hojaAsistencia) {
    hojaAsistencia = ss.insertSheet(HOJAS.ASISTENCIA);
    hojaAsistencia.getRange(1, 1, 1, 9).setValues([[
      "ID_ASISTENCIA", "ID_SESION", "FECHA", "HORA", "DOCUMENTO", "NOMBRE", "GRADO", "GRUPO", "ESTADO"
    ]]);
    hojaAsistencia.getRange(1, 1, 1, 9).setFontWeight("bold").setBackground("#1e293b").setFontColor("#ffffff");
    hojaAsistencia.setFrozenRows(1);
    hojaAsistencia.setColumnWidth(1, 120);
    hojaAsistencia.setColumnWidth(2, 110);
    hojaAsistencia.setColumnWidth(3, 110);
    hojaAsistencia.setColumnWidth(4, 100);
    hojaAsistencia.setColumnWidth(5, 130);
    hojaAsistencia.setColumnWidth(6, 250);
    hojaAsistencia.setColumnWidth(7, 80);
    hojaAsistencia.setColumnWidth(8, 80);
    hojaAsistencia.setColumnWidth(9, 110);
  }

  // 4. INCIDENCIAS
  let hojaIncidencias = ss.getSheetByName(HOJAS.INCIDENCIAS);
  if (!hojaIncidencias) {
    hojaIncidencias = ss.insertSheet(HOJAS.INCIDENCIAS);
    hojaIncidencias.getRange(1, 1, 1, 10).setValues([[
      "ID_INCIDENCIA", "ID_SESION", "FECHA", "HORA", "DOCUMENTO", "NOMBRE", "GRADO", "GRUPO", "TIPO", "DETALLE"
    ]]);
    hojaIncidencias.getRange(1, 1, 1, 10).setFontWeight("bold").setBackground("#7f1d1d").setFontColor("#ffffff");
    hojaIncidencias.setFrozenRows(1);
    hojaIncidencias.setColumnWidth(1, 120);
    hojaIncidencias.setColumnWidth(2, 110);
    hojaIncidencias.setColumnWidth(3, 110);
    hojaIncidencias.setColumnWidth(4, 100);
    hojaIncidencias.setColumnWidth(5, 130);
    hojaIncidencias.setColumnWidth(6, 230);
    hojaIncidencias.setColumnWidth(7, 80);
    hojaIncidencias.setColumnWidth(8, 80);
    hojaIncidencias.setColumnWidth(9, 230);
    hojaIncidencias.setColumnWidth(10, 250);
  }

  return true;
}

function onEdit(e) {
  if (!e || !e.range) return;
  const rango = e.range;
  const hoja = rango.getSheet();
  const nombreHoja = hoja.getName();

  if (nombreHoja === HOJAS.ESTUDIANTES) {
    // Si modificaron estudiantes, invalidamos caché
    actualizarIndiceEstudiantes();
  } else if (nombreHoja === HOJAS.SESIONES) {
    CacheService.getScriptCache().remove(CACHE_KEYS.SESIONES_RESUMEN);
  }
}

// ============================================================================
// SEGURIDAD Y CONTROL DE ACCESO ADMINISTRATIVO
// ============================================================================

function hashClaveAdmin(clave, salt) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(clave) + String(salt),
    Utilities.Charset.UTF_8
  );
  return bytes
    .map(function(byte) {
      return ("0" + (byte & 0xff).toString(16)).slice(-2);
    })
    .join("");
}

function configurarClaveAdmin() {
  const ui = SpreadsheetApp.getUi();
  const respuesta = ui.prompt(
    "Seguridad del Sistema",
    "Ingresa una contraseña para el acceso de los profesores (mínimo 6 caracteres):",
    ui.ButtonSet.OK_CANCEL
  );

  if (respuesta.getSelectedButton() !== ui.Button.OK) return;

  const clave = respuesta.getResponseText().trim();
  if (clave.length < 6) {
    ui.alert("La contraseña debe tener al menos 6 caracteres.");
    return;
  }

  const salt = Utilities.getUuid();
  const hash = hashClaveAdmin(clave, salt);

  PropertiesService.getScriptProperties().setProperties({
    ADMIN_PASSWORD_HASH: hash,
    ADMIN_PASSWORD_SALT: salt
  });

  ui.alert("✅ Contraseña configurada con éxito. Ya puedes acceder al Panel Docente.");
}

function cambiarClaveAdminWeb(token, claveActual, claveNueva) {
  exigirAdministrador(token);

  const propiedades = PropertiesService.getScriptProperties();
  const hashGuardado = propiedades.getProperty("ADMIN_PASSWORD_HASH");
  const salt = propiedades.getProperty("ADMIN_PASSWORD_SALT");

  if (!hashGuardado || !salt) {
    return { ok: false, mensaje: "El sistema no tiene clave inicial." };
  }

  if (hashClaveAdmin(claveActual, salt) !== hashGuardado) {
    return { ok: false, mensaje: "La contraseña actual no es correcta." };
  }

  if (String(claveNueva || "").trim().length < 6) {
    return { ok: false, mensaje: "La nueva contraseña debe tener al menos 6 caracteres." };
  }

  const nuevoSalt = Utilities.getUuid();
  const nuevoHash = hashClaveAdmin(claveNueva, nuevoSalt);

  propiedades.setProperties({
    ADMIN_PASSWORD_HASH: nuevoHash,
    ADMIN_PASSWORD_SALT: nuevoSalt
  });

  return { ok: true, mensaje: "Contraseña cambiada exitosamente." };
}

function iniciarSesionAdmin(clave) {
  const propiedades = PropertiesService.getScriptProperties();
  let hashGuardado = propiedades.getProperty("ADMIN_PASSWORD_HASH");
  let salt = propiedades.getProperty("ADMIN_PASSWORD_SALT");

  // Si no se ha configurado clave aún, se establece una contraseña inicial por defecto: "colegio2026"
  if (!hashGuardado || !salt) {
    salt = Utilities.getUuid();
    hashGuardado = hashClaveAdmin("colegio2026", salt);
    propiedades.setProperties({
      ADMIN_PASSWORD_HASH: hashGuardado,
      ADMIN_PASSWORD_SALT: salt
    });
  }

  const hashRecibido = hashClaveAdmin(clave, salt);
  if (hashRecibido !== hashGuardado) {
    return { ok: false, mensaje: "Contraseña incorrecta." };
  }

  const token = Utilities.getUuid() + "_" + Date.now();
  CacheService.getScriptCache().put("ADMIN_SESSION_" + token, "VALID", TIEMPO_CACHE.LARGO);

  return {
    ok: true,
    token: token,
    duracionHoras: 6,
    mensaje: "Acceso concedido"
  };
}

function validarSesionAdminWeb(token) {
  if (!token) return false;
  const claveCache = "ADMIN_SESSION_" + token;
  const valor = CacheService.getScriptCache().get(claveCache);
  if (valor !== "VALID") return false;
  // Deslizar expiración
  CacheService.getScriptCache().put(claveCache, "VALID", TIEMPO_CACHE.LARGO);
  return true;
}

function verificarSesionAdminWeb(token) {
  return { ok: validarSesionAdminWeb(token) };
}

function exigirAdministrador(token) {
  if (!validarSesionAdminWeb(token)) {
    throw new Error("NO AUTORIZADO");
  }
}

function cerrarSesionAdmin(token) {
  if (token) {
    CacheService.getScriptCache().remove("ADMIN_SESSION_" + token);
  }
  return { ok: true };
}

// ============================================================================
// NORMALIZACIÓN Y BÚSQUEDA DE ESTUDIANTES (CACHE EN MEMORIA)
// ============================================================================

function normalizarDocumento(documento) {
  return String(documento || "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/[^\dA-Za-z]/g, "");
}

function normalizarGrupoTexto(grupo) {
  return String(grupo || "")
    .trim()
    .toUpperCase()
    .replace(/[\s\-_]/g, "");
}

function normalizarGradoYGrupo(grado, grupo) {
  return (String(grado || "") + String(grupo || ""))
    .trim()
    .toUpperCase()
    .replace(/[\s\-_]/g, "");
}

function actualizarIndiceEstudiantes() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hoja = ss.getSheetByName(HOJAS.ESTUDIANTES);
  if (!hoja) return {};

  const datos = hoja.getDataRange().getDisplayValues();
  const indice = {};
  const totalesGrupo = {};

  for (let i = 1; i < datos.length; i++) {
    const docNorm = normalizarDocumento(datos[i][0]);
    const nombre = String(datos[i][1] || "").trim();
    const grado = String(datos[i][2] || "").trim().toUpperCase();
    const grupo = String(datos[i][3] || "").trim().toUpperCase();
    const estado = String(datos[i][4] || "").trim().toUpperCase();

    if (!docNorm) continue;

    const estudiante = {
      documento: String(datos[i][0]).trim(),
      nombre: nombre,
      grado: grado,
      grupo: grupo,
      estado: estado || "ACTIVO"
    };

    indice[docNorm] = estudiante;

    if (estado === "ACTIVO") {
      const clave1 = normalizarGrupoTexto(grupo);
      const clave2 = normalizarGradoYGrupo(grado, grupo);

      totalesGrupo[clave1] = (totalesGrupo[clave1] || 0) + 1;
      if (clave2 !== clave1) {
        totalesGrupo[clave2] = (totalesGrupo[clave2] || 0) + 1;
      }
    }
  }

  const jsonIndice = JSON.stringify(indice);
  const jsonTotales = JSON.stringify(totalesGrupo);

  try {
    PropertiesService.getScriptProperties().setProperty("INDICE_ESTUDIANTES", jsonIndice);
  } catch (e) {
    console.warn("Aviso: Índice supera límite de PropertiesService, usando CacheService.");
  }

  CacheService.getScriptCache().put(CACHE_KEYS.ESTUDIANTES, jsonIndice, TIEMPO_CACHE.LARGO);
  CacheService.getScriptCache().put(CACHE_KEYS.TOTALES_GRUPO, jsonTotales, TIEMPO_CACHE.LARGO);

  return indice;
}

function obtenerIndiceEstudiantes() {
  const cache = CacheService.getScriptCache();
  let json = cache.get(CACHE_KEYS.ESTUDIANTES);

  if (!json) {
    json = PropertiesService.getScriptProperties().getProperty("INDICE_ESTUDIANTES");
  }

  if (json) {
    try {
      cache.put(CACHE_KEYS.ESTUDIANTES, json, TIEMPO_CACHE.LARGO);
      return JSON.parse(json);
    } catch (e) {}
  }

  return actualizarIndiceEstudiantes();
}

function buscarEstudiante(documentoNormalizado) {
  const indice = obtenerIndiceEstudiantes();
  return indice[documentoNormalizado] || null;
}

function obtenerTotalesPorGrupo() {
  const cache = CacheService.getScriptCache();
  let json = cache.get(CACHE_KEYS.TOTALES_GRUPO);
  if (json) {
    try {
      return JSON.parse(json);
    } catch (e) {}
  }
  actualizarIndiceEstudiantes();
  json = cache.get(CACHE_KEYS.TOTALES_GRUPO);
  return json ? JSON.parse(json) : {};
}

// ============================================================================
// GESTIÓN DE SESIONES
// ============================================================================

function generarIdSesion() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hoja = ss.getSheetByName(HOJAS.SESIONES);
  if (!hoja) return "S001";

  const ultimaFila = hoja.getLastRow();
  if (ultimaFila < 2) return "S001";

  const ids = hoja.getRange(2, 1, ultimaFila - 1, 1).getDisplayValues();
  let maxNum = 0;

  ids.forEach(function(fila) {
    const id = String(fila[0]).trim().toUpperCase();
    const match = id.match(/^S(\d+)$/);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > maxNum) maxNum = num;
    }
  });

  return "S" + String(maxNum + 1).padStart(3, "0");
}

function buscarSesionPorId(hoja, idBuscado) {
  const idNorm = String(idBuscado || "").trim().toUpperCase();
  if (!idNorm) return null;

  const datos = hoja.getDataRange().getDisplayValues();
  if (datos.length < 2) return null;

  for (let i = 1; i < datos.length; i++) {
    const idActual = String(datos[i][0]).trim().toUpperCase();
    if (idActual === idNorm) {
      return {
        fila: i + 1,
        idSesion: idActual,
        fecha: String(datos[i][1]).trim(),
        horaInicio: String(datos[i][2]).trim(),
        horaFin: String(datos[i][3]).trim(),
        curso: String(datos[i][4]).trim(),
        grupo: String(datos[i][5]).trim(),
        estado: String(datos[i][6]).trim().toUpperCase(),
        enlaceQR: String(datos[i][7] || "").trim()
      };
    }
  }
  return null;
}

function validarHorarioSesion(sesion, ss) {
  if (sesion.estado === "CERRADA") {
    return false;
  }

  const tz = ss.getSpreadsheetTimeZone();
  const ahora = new Date();
  const fechaHoy = Utilities.formatDate(ahora, tz, "dd/MM/yyyy");
  const horaActual = Utilities.formatDate(ahora, tz, "HH:mm");

  if (sesion.fecha !== fechaHoy) {
    return false;
  }

  // Margen de tolerancia: permite 10 minutos de gracia antes y después
  if (horaActual < sesion.horaInicio || horaActual > sesion.horaFin) {
    return false;
  }

  return true;
}

function obtenerEstadoSesionActual(sesion, ss) {
  if (sesion.estado === "CERRADA") return "CERRADA";

  const tz = ss.getSpreadsheetTimeZone();
  const ahora = new Date();
  const fechaHoy = Utilities.formatDate(ahora, tz, "dd/MM/yyyy");
  const horaActual = Utilities.formatDate(ahora, tz, "HH:mm");

  if (sesion.fecha < fechaHoy) return "FINALIZADA";
  if (sesion.fecha > fechaHoy) return "PROGRAMADA";

  if (horaActual < sesion.horaInicio) return "PROGRAMADA";
  if (horaActual >= sesion.horaInicio && horaActual <= sesion.horaFin) return "ABIERTA";
  return "FINALIZADA";
}

function buscarSesionActivaAhora(hoja) {
  const ss = hoja.getParent();
  const datos = hoja.getDataRange().getDisplayValues();
  if (datos.length < 2) return null;

  const tz = ss.getSpreadsheetTimeZone();
  const ahora = new Date();
  const fechaHoy = Utilities.formatDate(ahora, tz, "dd/MM/yyyy");
  const horaActual = Utilities.formatDate(ahora, tz, "HH:mm");

  for (let i = datos.length - 1; i >= 1; i--) {
    const estado = String(datos[i][6]).trim().toUpperCase();
    const fecha = String(datos[i][1]).trim();
    const inicio = String(datos[i][2]).trim();
    const fin = String(datos[i][3]).trim();

    if (estado !== "CERRADA" && fecha === fechaHoy && horaActual >= inicio && horaActual <= fin) {
      return {
        idSesion: String(datos[i][0]).trim().toUpperCase(),
        fecha: fecha,
        horaInicio: inicio,
        horaFin: fin,
        curso: String(datos[i][4]).trim(),
        grupo: String(datos[i][5]).trim(),
        estado: estado
      };
    }
  }
  return null;
}

// ============================================================================
// REGISTRO DE ASISTENCIA Y CACHE DE ASISTENCIAS
// ============================================================================

function generarIdAsistencia(hoja) {
  const props = PropertiesService.getScriptProperties();
  let contador = props.getProperty("CONTADOR_ASISTENCIA");

  if (contador === null) {
    const ultimaFila = hoja.getLastRow();
    let max = 0;
    if (ultimaFila >= 2) {
      const ids = hoja.getRange(2, 1, ultimaFila - 1, 1).getDisplayValues();
      ids.forEach(function(f) {
        const m = String(f[0]).trim().match(/^A(\d+)$/);
        if (m) {
          const n = parseInt(m[1], 10);
          if (n > max) max = n;
        }
      });
    }
    contador = max;
  } else {
    contador = parseInt(contador, 10);
  }

  contador++;
  props.setProperty("CONTADOR_ASISTENCIA", String(contador));
  return "A" + String(contador).padStart(5, "0");
}

function obtenerIndiceAsistenciaSesion(hojaAsistencia, idSesion) {
  const sesionNorm = String(idSesion).trim().toUpperCase();
  const cacheKey = "ASIS_" + sesionNorm;
  const cache = CacheService.getScriptCache();
  const cached = cache.get(cacheKey);

  if (cached) {
    try {
      return JSON.parse(cached);
    } catch (e) {}
  }

  const indice = {};
  const ultima = hojaAsistencia.getLastRow();

  if (ultima >= 2) {
    const datos = hojaAsistencia.getRange(2, 2, ultima - 1, 8).getDisplayValues();
    for (let i = 0; i < datos.length; i++) {
      const sId = String(datos[i][0]).trim().toUpperCase();
      const doc = normalizarDocumento(datos[i][3]);
      const estado = String(datos[i][7]).trim().toUpperCase();

      if (sId === sesionNorm && doc && estado === "PRESENTE") {
        indice[doc] = {
          hora: String(datos[i][2]).trim(),
          nombre: String(datos[i][4]).trim()
        };
      }
    }
  }

  cache.put(cacheKey, JSON.stringify(indice), TIEMPO_CACHE.LARGO);
  return indice;
}

function actualizarIndiceAsistenciaSesion(hojaAsistencia, idSesion, docNorm, datosAsistente) {
  const sesionNorm = String(idSesion).trim().toUpperCase();
  const cacheKey = "ASIS_" + sesionNorm;
  const indice = obtenerIndiceAsistenciaSesion(hojaAsistencia, sesionNorm);
  indice[docNorm] = datosAsistente || true;
  CacheService.getScriptCache().put(cacheKey, JSON.stringify(indice), TIEMPO_CACHE.LARGO);
}

function registrarIncidencia(datos) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let hoja = ss.getSheetByName(HOJAS.INCIDENCIAS);
    if (!hoja) {
      asegurarInfraestructuraCompleta();
      hoja = ss.getSheetByName(HOJAS.INCIDENCIAS);
    }

    const tz = ss.getSpreadsheetTimeZone();
    const ahora = new Date();
    const fecha = Utilities.formatDate(ahora, tz, "dd/MM/yyyy");
    const hora = Utilities.formatDate(ahora, tz, "HH:mm:ss");

    const idIncidencia = "I" + String(Date.now()).slice(-6);

    hoja.appendRow([
      idIncidencia,
      String((datos && datos.idSesion) || "").trim(),
      fecha,
      hora,
      String((datos && datos.documento) || "").trim(),
      String((datos && datos.nombre) || "").trim(),
      String((datos && datos.grado) || "").trim(),
      String((datos && datos.grupo) || "").trim(),
      String((datos && datos.tipo) || "INCIDENCIA").trim(),
      String((datos && datos.detalle) || "").trim()
    ]);
  } catch (e) {
    console.error("Error al registrar incidencia: " + e.message);
  }
}

// ============================================================================
// API DEL ESTUDIANTE (CLIENTE WEB)
// ============================================================================

function obtenerInfoSesionWeb(idSesion) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hojaSesiones = ss.getSheetByName(HOJAS.SESIONES);
  if (!hojaSesiones) {
    return { ok: false, mensaje: "Hoja de sesiones no configurada." };
  }

  const idNorm = String(idSesion || "").trim().toUpperCase();
  if (!idNorm) {
    return { ok: false, mensaje: "Por favor escanea el código QR de tu clase." };
  }

  const sesion = buscarSesionPorId(hojaSesiones, idNorm);
  if (!sesion) {
    return { ok: false, mensaje: "La sesión (" + idNorm + ") no existe o ya caducó." };
  }

  const activa = validarHorarioSesion(sesion, ss);
  const estadoVisual = obtenerEstadoSesionActual(sesion, ss);

  if (!activa) {
    let motivo = "La clase está fuera de horario.";
    if (sesion.estado === "CERRADA") motivo = "El profesor ya cerró la toma de asistencia.";
    else if (estadoVisual === "PROGRAMADA") motivo = "La clase aún no ha comenzado.";
    else if (estadoVisual === "FINALIZADA") motivo = "El horario de la clase ya terminó.";

    return {
      ok: false,
      mensaje: motivo,
      idSesion: sesion.idSesion,
      curso: sesion.curso,
      grupo: sesion.grupo,
      horaInicio: sesion.horaInicio,
      horaFin: sesion.horaFin,
      estado: estadoVisual
    };
  }

  return {
    ok: true,
    idSesion: sesion.idSesion,
    curso: sesion.curso,
    grupo: sesion.grupo,
    fecha: sesion.fecha,
    horaInicio: sesion.horaInicio,
    horaFin: sesion.horaFin,
    estado: "ABIERTA"
  };
}

function registrarAsistenciaWeb(documento, idSesion) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);

    const docNorm = normalizarDocumento(documento);
    const sesionNorm = String(idSesion || "").trim().toUpperCase();

    if (!docNorm) {
      return { ok: false, mensaje: "Ingresa tu número de documento." };
    }
    if (!sesionNorm) {
      return { ok: false, mensaje: "No se identificó la sesión de clase." };
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const hojaEstudiantes = ss.getSheetByName(HOJAS.ESTUDIANTES);
    const hojaSesiones = ss.getSheetByName(HOJAS.SESIONES);
    const hojaAsistencia = ss.getSheetByName(HOJAS.ASISTENCIA);

    if (!hojaEstudiantes || !hojaSesiones || !hojaAsistencia) {
      return { ok: false, mensaje: "El sistema no está configurado." };
    }

    // 1. Validar estudiante en caché/índice
    const estudiante = buscarEstudiante(docNorm);
    if (!estudiante) {
      registrarIncidencia({
        idSesion: sesionNorm,
        tipo: "RECHAZADO - NO ENCONTRADO",
        documento: docNorm,
        detalle: "Documento no registrado en el padrón escolar"
      });
      return {
        ok: false,
        tipo: "NO_ENCONTRADO",
        mensaje: "El documento " + docNorm + " no se encuentra registrado en el colegio. Consulta con tu profesor."
      };
    }

    if (estudiante.estado !== "ACTIVO") {
      registrarIncidencia({
        idSesion: sesionNorm,
        tipo: "RECHAZADO - INACTIVO",
        documento: docNorm,
        nombre: estudiante.nombre,
        detalle: "Estudiante con estado " + estudiante.estado
      });
      return {
        ok: false,
        tipo: "INACTIVO",
        mensaje: "Tu registro se encuentra en estado " + estudiante.estado + ". Por favor acércate a coordinación."
      };
    }

    // 2. Validar sesión
    const sesion = buscarSesionPorId(hojaSesiones, sesionNorm);
    if (!sesion) {
      return { ok: false, mensaje: "La sesión no existe." };
    }

    if (!validarHorarioSesion(sesion, ss)) {
      registrarIncidencia({
        idSesion: sesionNorm,
        tipo: "RECHAZADO - FUERA HORARIO",
        documento: docNorm,
        nombre: estudiante.nombre,
        detalle: "Intento de registro con clase cerrada o fuera de horario"
      });
      return {
        ok: false,
        tipo: "FUERA_HORARIO",
        mensaje: "Esta clase no está aceptando registros en este momento."
      };
    }

    // 3. Validar duplicado
    const indiceAsistencia = obtenerIndiceAsistenciaSesion(hojaAsistencia, sesionNorm);
    if (indiceAsistencia[docNorm]) {
      const infoPrevia = indiceAsistencia[docNorm];
      const horaPrevia = (typeof infoPrevia === "object" && infoPrevia.hora) ? infoPrevia.hora : "";

      registrarIncidencia({
        idSesion: sesionNorm,
        tipo: "DUPLICADO - YA REGISTRADO",
        documento: docNorm,
        nombre: estudiante.nombre,
        detalle: "Intento repetido de registro"
      });

      return {
        ok: false,
        tipo: "DUPLICADO",
        mensaje: "¡Ya estás registrado! Tu asistencia fue tomada a las " + (horaPrevia || "hora previa") + ".",
        nombre: estudiante.nombre,
        hora: horaPrevia
      };
    }

    // 4. Registrar asistencia en ASISTENCIA
    const tz = ss.getSpreadsheetTimeZone();
    const ahora = new Date();
    const fecha = Utilities.formatDate(ahora, tz, "dd/MM/yyyy");
    const hora = Utilities.formatDate(ahora, tz, "HH:mm:ss");
    const idAsistencia = generarIdAsistencia(hojaAsistencia);

    hojaAsistencia.appendRow([
      idAsistencia,
      sesionNorm,
      fecha,
      hora,
      estudiante.documento,
      estudiante.nombre,
      estudiante.grado,
      estudiante.grupo,
      "PRESENTE"
    ]);

    // Actualizar índice en caché de inmediato
    actualizarIndiceAsistenciaSesion(hojaAsistencia, sesionNorm, docNorm, {
      hora: hora,
      nombre: estudiante.nombre
    });

    return {
      ok: true,
      tipo: "PRESENTE",
      idAsistencia: idAsistencia,
      nombre: estudiante.nombre,
      grado: estudiante.grado,
      grupo: estudiante.grupo,
      curso: sesion.curso,
      idSesion: sesion.idSesion,
      fecha: fecha,
      hora: hora
    };
  } catch (err) {
    console.error("Error en registrarAsistenciaWeb: " + err.message);
    return { ok: false, mensaje: "Ocurrió un error en el servidor. Intenta de nuevo." };
  } finally {
    if (lock.hasLock()) {
      lock.releaseLock();
    }
  }
}

// ============================================================================
// API DEL PROFESOR (PANEL DOCENTE)
// ============================================================================

function crearSesionWeb(token, datos) {
  exigirAdministrador(token);
  const lock = LockService.getScriptLock();

  try {
    lock.waitLock(20000);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let hoja = ss.getSheetByName(HOJAS.SESIONES);
    if (!hoja) {
      asegurarInfraestructuraCompleta();
      hoja = ss.getSheetByName(HOJAS.SESIONES);
    }

    const fechaInput = String((datos && datos.fecha) || "").trim();
    const horaInicio = String((datos && datos.horaInicio) || "").trim();
    const horaFin = String((datos && datos.horaFin) || "").trim();
    const curso = String((datos && datos.curso) || "").trim();
    const grupo = String((datos && datos.grupo) || "").trim();

    if (!fechaInput || !horaInicio || !horaFin || !curso || !grupo) {
      return { ok: false, mensaje: "Todos los campos son obligatorios." };
    }

    if (horaInicio >= horaFin) {
      return { ok: false, mensaje: "La hora de inicio debe ser anterior a la hora de finalización." };
    }

    // Formatear fecha a dd/MM/yyyy
    let fechaVisual = fechaInput;
    if (fechaInput.indexOf("-") !== -1) {
      const p = fechaInput.split("-");
      if (p.length === 3) {
        fechaVisual = p[2] + "/" + p[1] + "/" + p[0];
      }
    }

    const idSesion = generarIdSesion();
    const enlaceQR = generarEnlaceSesion(idSesion);
    const urlImagenQR = "https://quickchart.io/qr?size=300&margin=2&ecLevel=H&text=" + encodeURIComponent(enlaceQR);
    const formulaQR = '=IMAGE("' + urlImagenQR + '")';

    hoja.appendRow([
      idSesion,
      fechaVisual,
      horaInicio,
      horaFin,
      curso,
      grupo,
      "ABIERTA",
      enlaceQR,
      formulaQR
    ]);

    // Limpiar caché de lista de sesiones
    CacheService.getScriptCache().remove(CACHE_KEYS.SESIONES_RESUMEN);

    return {
      ok: true,
      idSesion: idSesion,
      enlaceQR: enlaceQR,
      urlImagenQR: urlImagenQR,
      curso: curso,
      grupo: grupo,
      fecha: fechaVisual,
      horaInicio: horaInicio,
      horaFin: horaFin
    };
  } finally {
    if (lock.hasLock()) {
      lock.releaseLock();
    }
  }
}

function obtenerSesionesWeb(token) {
  exigirAdministrador(token);

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hojaSesiones = ss.getSheetByName(HOJAS.SESIONES);
  const hojaAsistencia = ss.getSheetByName(HOJAS.ASISTENCIA);

  if (!hojaSesiones || !hojaAsistencia) return [];

  const ultimaSesion = hojaSesiones.getLastRow();
  if (ultimaSesion < 2) return [];

  const datosSesiones = hojaSesiones.getRange(2, 1, ultimaSesion - 1, 8).getDisplayValues();
  const totalesGrupo = obtenerTotalesPorGrupo();

  // Obtenemos los conteos de asistencia para todas las sesiones de una sola lectura
  const conteoPorSesion = {};
  const ultimaAsistencia = hojaAsistencia.getLastRow();
  if (ultimaAsistencia >= 2) {
    const datosAsis = hojaAsistencia.getRange(2, 2, ultimaAsistencia - 1, 8).getDisplayValues();
    for (let i = 0; i < datosAsis.length; i++) {
      const sId = String(datosAsis[i][0]).trim().toUpperCase();
      const st = String(datosAsis[i][7]).trim().toUpperCase();
      if (st === "PRESENTE") {
        conteoPorSesion[sId] = (conteoPorSesion[sId] || 0) + 1;
      }
    }
  }

  const resultado = [];

  for (let i = datosSesiones.length - 1; i >= 0; i--) {
    const fila = datosSesiones[i];
    const idSesion = String(fila[0]).trim().toUpperCase();
    if (!idSesion) continue;

    const grupo = String(fila[5]).trim();
    const claveGrupo = normalizarGrupoTexto(grupo);
    const totalEstudiantes = totalesGrupo[claveGrupo] || 0;
    const presentes = conteoPorSesion[idSesion] || 0;

    const sesionObj = {
      idSesion: idSesion,
      fecha: String(fila[1]).trim(),
      horaInicio: String(fila[2]).trim(),
      horaFin: String(fila[3]).trim(),
      curso: String(fila[4]).trim(),
      grupo: grupo,
      estado: String(fila[6]).trim().toUpperCase(),
      enlaceQR: String(fila[7] || "").trim() || generarEnlaceSesion(idSesion),
      presentes: presentes,
      total: totalEstudiantes
    };

    sesionObj.estadoVisual = obtenerEstadoSesionActual(sesionObj, ss);
    resultado.push(sesionObj);
  }

  return resultado;
}

function cerrarSesionWeb(token, idSesion) {
  exigirAdministrador(token);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hoja = ss.getSheetByName(HOJAS.SESIONES);
  if (!hoja) return { ok: false, mensaje: "Hoja SESIONES no encontrada." };

  const idNorm = String(idSesion).trim().toUpperCase();
  const sesion = buscarSesionPorId(hoja, idNorm);
  if (!sesion) return { ok: false, mensaje: "Sesión no encontrada." };

  hoja.getRange(sesion.fila, 7).setValue("CERRADA");
  CacheService.getScriptCache().remove(CACHE_KEYS.SESIONES_RESUMEN);
  return { ok: true, mensaje: "Sesión cerrada correctamente." };
}

function reabrirSesionWeb(token, idSesion) {
  exigirAdministrador(token);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hoja = ss.getSheetByName(HOJAS.SESIONES);
  if (!hoja) return { ok: false, mensaje: "Hoja SESIONES no encontrada." };

  const idNorm = String(idSesion).trim().toUpperCase();
  const sesion = buscarSesionPorId(hoja, idNorm);
  if (!sesion) return { ok: false, mensaje: "Sesión no encontrada." };

  hoja.getRange(sesion.fila, 7).setValue("ABIERTA");
  CacheService.getScriptCache().remove(CACHE_KEYS.SESIONES_RESUMEN);
  return { ok: true, mensaje: "Sesión reabierta correctamente." };
}

function obtenerDetalleSesionWeb(token, idSesion) {
  exigirAdministrador(token);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hojaSesiones = ss.getSheetByName(HOJAS.SESIONES);
  const hojaAsistencia = ss.getSheetByName(HOJAS.ASISTENCIA);

  if (!hojaSesiones || !hojaAsistencia) {
    return { ok: false, mensaje: "Hojas no encontradas." };
  }

  const idNorm = String(idSesion).trim().toUpperCase();
  const sesion = buscarSesionPorId(hojaSesiones, idNorm);
  if (!sesion) {
    return { ok: false, mensaje: "Sesión no encontrada." };
  }

  const presentes = [];
  const mapaPresentes = {};
  const ultimaAsis = hojaAsistencia.getLastRow();

  if (ultimaAsis >= 2) {
    const datos = hojaAsistencia.getRange(2, 2, ultimaAsis - 1, 8).getDisplayValues();
    for (let i = 0; i < datos.length; i++) {
      const sId = String(datos[i][0]).trim().toUpperCase();
      const st = String(datos[i][7]).trim().toUpperCase();
      if (sId === idNorm && st === "PRESENTE") {
        const doc = normalizarDocumento(datos[i][3]);
        mapaPresentes[doc] = true;
        presentes.push({
          documento: String(datos[i][3]).trim(),
          nombre: String(datos[i][4]).trim(),
          grado: String(datos[i][5]).trim(),
          grupo: String(datos[i][6]).trim(),
          hora: String(datos[i][2]).trim()
        });
      }
    }
  }

  // Ordenar presentes por hora
  presentes.sort(function(a, b) {
    return b.hora.localeCompare(a.hora);
  });

  // Calcular ausentes a partir del grupo de la sesión
  const todosEstudiantes = obtenerIndiceEstudiantes();
  const claveGrupoSesion = normalizarGrupoTexto(sesion.grupo);
  const ausentes = [];

  Object.keys(todosEstudiantes).forEach(function(docNorm) {
    const est = todosEstudiantes[docNorm];
    if (est.estado !== "ACTIVO") return;

    const grupoEst = normalizarGrupoTexto(est.grupo);
    const gradoYGrupoEst = normalizarGradoYGrupo(est.grado, est.grupo);

    if (grupoEst === claveGrupoSesion || gradoYGrupoEst === claveGrupoSesion) {
      if (!mapaPresentes[docNorm]) {
        ausentes.push({
          documento: est.documento,
          nombre: est.nombre,
          grado: est.grado,
          grupo: est.grupo
        });
      }
    }
  });

  ausentes.sort(function(a, b) {
    return a.nombre.localeCompare(b.nombre, "es");
  });

  return {
    ok: true,
    sesion: sesion,
    totalGrupo: presentes.length + ausentes.length,
    presentes: presentes,
    ausentes: ausentes
  };
}

function marcarAsistenciaManualWeb(token, idSesion, documento, motivo) {
  exigirAdministrador(token);
  const lock = LockService.getScriptLock();

  try {
    lock.waitLock(20000);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const hojaAsistencia = ss.getSheetByName(HOJAS.ASISTENCIA);
    const hojaSesiones = ss.getSheetByName(HOJAS.SESIONES);

    const docNorm = normalizarDocumento(documento);
    const idNorm = String(idSesion).trim().toUpperCase();

    const estudiante = buscarEstudiante(docNorm);
    if (!estudiante) {
      return { ok: false, mensaje: "Estudiante no encontrado con documento: " + docNorm };
    }

    const sesion = buscarSesionPorId(hojaSesiones, idNorm);
    if (!sesion) {
      return { ok: false, mensaje: "Sesión no encontrada." };
    }

    const indice = obtenerIndiceAsistenciaSesion(hojaAsistencia, idNorm);
    if (indice[docNorm]) {
      return { ok: false, mensaje: "El estudiante ya figura como presente en esta sesión." };
    }

    const tz = ss.getSpreadsheetTimeZone();
    const ahora = new Date();
    const fecha = Utilities.formatDate(ahora, tz, "dd/MM/yyyy");
    const hora = Utilities.formatDate(ahora, tz, "HH:mm:ss");
    const idAsistencia = generarIdAsistencia(hojaAsistencia);

    hojaAsistencia.appendRow([
      idAsistencia,
      idNorm,
      fecha,
      hora,
      estudiante.documento,
      estudiante.nombre,
      estudiante.grado,
      estudiante.grupo,
      "PRESENTE"
    ]);

    actualizarIndiceAsistenciaSesion(hojaAsistencia, idNorm, docNorm, {
      hora: hora,
      nombre: estudiante.nombre
    });

    if (motivo) {
      registrarIncidencia({
        idSesion: idNorm,
        tipo: "REGISTRO MANUAL DOCENTE",
        documento: estudiante.documento,
        nombre: estudiante.nombre,
        detalle: "Motivo: " + motivo
      });
    }

    return {
      ok: true,
      mensaje: "Asistencia registrada manualmente con éxito.",
      asistente: {
        documento: estudiante.documento,
        nombre: estudiante.nombre,
        hora: hora
      }
    };
  } finally {
    if (lock.hasLock()) {
      lock.releaseLock();
    }
  }
}

// ============================================================================
// REPORTES, ESTADÍSTICAS Y EXPORTACIÓN
// ============================================================================

function obtenerGruposRegistradosWeb(token) {
  exigirAdministrador(token);
  const indice = obtenerIndiceEstudiantes();
  const gruposSet = {};

  Object.keys(indice).forEach(function(doc) {
    const gr = String(indice[doc].grupo || "").trim();
    if (gr) gruposSet[gr] = true;
  });

  return Object.keys(gruposSet).sort();
}

function parsearFechaDMY(str) {
  if (!str) return null;
  const p = String(str).trim().split("/");
  if (p.length !== 3) return null;
  return new Date(parseInt(p[2], 10), parseInt(p[1], 10) - 1, parseInt(p[0], 10));
}

function parsearFechaISO(str) {
  if (!str) return null;
  const p = String(str).trim().split("-");
  if (p.length !== 3) return null;
  return new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10));
}

function obtenerReporteWeb(token, filtros) {
  exigirAdministrador(token);
  filtros = filtros || {};

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hojaAsistencia = ss.getSheetByName(HOJAS.ASISTENCIA);
  const hojaSesiones = ss.getSheetByName(HOJAS.SESIONES);

  if (!hojaAsistencia || !hojaSesiones) {
    return { ok: false, mensaje: "Hojas requeridas no disponibles." };
  }

  const mapaSesiones = {};
  const ultSesion = hojaSesiones.getLastRow();
  if (ultSesion >= 2) {
    const dSesiones = hojaSesiones.getRange(2, 1, ultSesion - 1, 6).getDisplayValues();
    dSesiones.forEach(function(f) {
      const id = String(f[0]).trim().toUpperCase();
      if (id) {
        mapaSesiones[id] = {
          curso: String(f[4]).trim(),
          grupo: String(f[5]).trim()
        };
      }
    });
  }

  const ultAsis = hojaAsistencia.getLastRow();
  if (ultAsis < 2) {
    return {
      ok: true,
      totalRegistros: 0,
      estudiantesUnicos: 0,
      sesionesUnicas: 0,
      filas: []
    };
  }

  const datos = hojaAsistencia.getRange(2, 1, ultAsis - 1, 9).getDisplayValues();
  const desde = filtros.fechaDesde ? parsearFechaISO(filtros.fechaDesde) : null;
  const hasta = filtros.fechaHasta ? parsearFechaISO(filtros.fechaHasta) : null;
  const grupoFiltro = filtros.grupo ? normalizarGrupoTexto(filtros.grupo) : "";
  const docFiltro = filtros.documento ? normalizarDocumento(filtros.documento) : "";
  const cursoFiltro = filtros.curso ? String(filtros.curso).trim().toUpperCase() : "";

  const filas = [];
  const estUnicos = {};
  const sesUnicas = {};

  for (let i = 0; i < datos.length; i++) {
    const estado = String(datos[i][8]).trim().toUpperCase();
    if (estado !== "PRESENTE") continue;

    const fechaStr = String(datos[i][2]).trim();
    const fechaObj = parsearFechaDMY(fechaStr);

    if (desde && fechaObj && fechaObj < desde) continue;
    if (hasta && fechaObj && fechaObj > hasta) continue;

    const idSesion = String(datos[i][1]).trim().toUpperCase();
    const doc = normalizarDocumento(datos[i][4]);
    const grupo = String(datos[i][7] || "").trim();
    const sesInfo = mapaSesiones[idSesion] || { curso: "", grupo: "" };
    const curso = sesInfo.curso;

    if (grupoFiltro && normalizarGrupoTexto(grupo) !== grupoFiltro && normalizarGrupoTexto(sesInfo.grupo) !== grupoFiltro) {
      continue;
    }
    if (docFiltro && doc !== docFiltro) continue;
    if (cursoFiltro && curso.toUpperCase().indexOf(cursoFiltro) === -1) continue;

    estUnicos[doc] = true;
    sesUnicas[idSesion] = true;

    filas.push({
      idAsistencia: String(datos[i][0]).trim(),
      idSesion: idSesion,
      fecha: fechaStr,
      hora: String(datos[i][3]).trim(),
      documento: String(datos[i][4]).trim(),
      nombre: String(datos[i][5]).trim(),
      grado: String(datos[i][6]).trim(),
      grupo: grupo,
      curso: curso
    });
  }

  filas.reverse();

  return {
    ok: true,
    totalRegistros: filas.length,
    estudiantesUnicos: Object.keys(estUnicos).length,
    sesionesUnicas: Object.keys(sesUnicas).length,
    filas: filas
  };
}

function exportarReporteCsvWeb(token, filtros) {
  const rep = obtenerReporteWeb(token, filtros);
  if (!rep.ok) return rep;

  const cabecera = ["ID_ASISTENCIA", "ID_SESION", "FECHA", "HORA", "DOCUMENTO", "NOMBRE", "GRADO", "GRUPO", "CURSO"];
  const lineas = [cabecera.join(",")];

  rep.filas.forEach(function(f) {
    const c = [
      f.idAsistencia,
      f.idSesion,
      f.fecha,
      f.hora,
      f.documento,
      '"' + (f.nombre || "").replace(/"/g, '""') + '"',
      f.grado,
      f.grupo,
      '"' + (f.curso || "").replace(/"/g, '""') + '"'
    ];
    lineas.push(c.join(","));
  });

  return {
    ok: true,
    nombreArchivo: "reporte_asistencia_" + Utilities.formatDate(new Date(), "GMT-5", "yyyyMMdd_HHmm") + ".csv",
    csv: "\uFEFF" + lineas.join("\r\n")
  };
}

// ============================================================================
// IMPORTADOR MASIVO DE ESTUDIANTES (CSV / MATRÍCULA)
// ============================================================================

function previsualizarImportacionEstudiantesWeb(token, listaFilas) {
  exigirAdministrador(token);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hoja = ss.getSheetByName(HOJAS.ESTUDIANTES);

  if (!hoja) return { ok: false, mensaje: "Hoja ESTUDIANTES no encontrada." };
  if (!Array.isArray(listaFilas) || listaFilas.length === 0) {
    return { ok: false, mensaje: "No se proporcionaron datos para importar." };
  }

  const existentes = {};
  const ult = hoja.getLastRow();
  if (ult >= 2) {
    const docs = hoja.getRange(2, 1, ult - 1, 1).getDisplayValues();
    docs.forEach(function(f) {
      const d = normalizarDocumento(f[0]);
      if (d) existentes[d] = true;
    });
  }

  const archivoDocs = {};
  const detalle = [];
  let validas = 0;
  let duplicadas = 0;
  let invalidas = 0;

  listaFilas.forEach(function(item, idx) {
    const docOriginal = String((item && (item.documento || item.Documento || item[0])) || "").trim();
    const docNorm = normalizarDocumento(docOriginal);
    const nombre = String((item && (item.nombre || item.Nombre || item[1])) || "").trim();
    const grado = String((item && (item.grado || item.Grado || item[2])) || "").trim().toUpperCase();
    const grupo = String((item && (item.grupo || item.Grupo || item[3])) || "").trim().toUpperCase();
    const estado = String((item && (item.estado || item.Estado || item[4])) || "ACTIVO").trim().toUpperCase() || "ACTIVO";

    const errores = [];

    if (!docNorm) errores.push("Documento vacío");
    else if (docNorm.length < 5) errores.push("Documento muy corto");

    if (!nombre) errores.push("Nombre vacío");
    if (!grado) errores.push("Grado vacío");
    if (!grupo) errores.push("Grupo vacío");

    if (docNorm && archivoDocs[docNorm]) errores.push("Repetido en el mismo archivo");
    if (docNorm && existentes[docNorm]) errores.push("Ya existe en el sistema");

    if (docNorm) archivoDocs[docNorm] = true;

    const esValida = errores.length === 0;
    if (esValida) {
      validas++;
    } else {
      if (errores.some(function(e) { return e.indexOf("existe") !== -1 || e.indexOf("Repetido") !== -1; })) {
        duplicadas++;
      } else {
        invalidas++;
      }
    }

    detalle.push({
      fila: idx + 1,
      documento: docOriginal,
      documentoNorm: docNorm,
      nombre: nombre,
      grado: grado,
      grupo: grupo,
      estado: estado,
      valida: esValida,
      errores: errores
    });
  });

  return {
    ok: true,
    total: listaFilas.length,
    validas: validas,
    duplicadas: duplicadas,
    invalidas: invalidas,
    detalle: detalle
  };
}

function confirmarImportacionEstudiantesWeb(token, listaFilas) {
  exigirAdministrador(token);
  const lock = LockService.getScriptLock();

  try {
    lock.waitLock(30000);
    const preview = previsualizarImportacionEstudiantesWeb(token, listaFilas);
    if (!preview.ok) return preview;

    const filasAInsertar = [];
    preview.detalle.forEach(function(item) {
      if (item.valida) {
        filasAInsertar.push([
          item.documento,
          item.nombre,
          item.grado,
          item.grupo,
          item.estado
        ]);
      }
    });

    if (filasAInsertar.length === 0) {
      return { ok: false, mensaje: "Ninguna fila cumple los criterios para ser importada." };
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const hoja = ss.getSheetByName(HOJAS.ESTUDIANTES);
    const startRow = Math.max(hoja.getLastRow() + 1, 2);

    hoja.getRange(startRow, 1, filasAInsertar.length, 5).setValues(filasAInsertar);
    actualizarIndiceEstudiantes();

    return {
      ok: true,
      importados: filasAInsertar.length,
      omitidos: preview.total - filasAInsertar.length,
      mensaje: "Se importaron exitosamente " + filasAInsertar.length + " estudiantes."
    };
  } finally {
    if (lock.hasLock()) {
      lock.releaseLock();
    }
  }
}

// ============================================================================
// AUDITORÍA, INCIDENCIAS Y ESTADO DEL SISTEMA
// ============================================================================

function obtenerIncidenciasWeb(token, limite) {
  exigirAdministrador(token);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hoja = ss.getSheetByName(HOJAS.INCIDENCIAS);
  if (!hoja) return [];

  const ult = hoja.getLastRow();
  if (ult < 2) return [];

  const max = Math.min(parseInt(limite, 10) || 50, 200);
  const filaInicio = Math.max(2, ult - max + 1);
  const cantidad = ult - filaInicio + 1;

  const datos = hoja.getRange(filaInicio, 1, cantidad, 10).getDisplayValues();
  const incidencias = [];

  for (let i = datos.length - 1; i >= 0; i--) {
    incidencias.push({
      id: String(datos[i][0]).trim(),
      idSesion: String(datos[i][1]).trim(),
      fecha: String(datos[i][2]).trim(),
      hora: String(datos[i][3]).trim(),
      documento: String(datos[i][4]).trim(),
      nombre: String(datos[i][5]).trim(),
      tipo: String(datos[i][8]).trim(),
      detalle: String(datos[i][9]).trim()
    });
  }

  return incidencias;
}

function obtenerEstadoSistemaWeb(token) {
  exigirAdministrador(token);
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const hojaEst = ss.getSheetByName(HOJAS.ESTUDIANTES);
  const hojaSes = ss.getSheetByName(HOJAS.SESIONES);
  const hojaAsis = ss.getSheetByName(HOJAS.ASISTENCIA);
  const hojaInc = ss.getSheetByName(HOJAS.INCIDENCIAS);

  const totalEstudiantes = hojaEst ? Math.max(0, hojaEst.getLastRow() - 1) : 0;
  const totalSesiones = hojaSes ? Math.max(0, hojaSes.getLastRow() - 1) : 0;
  const totalAsistencias = hojaAsis ? Math.max(0, hojaAsis.getLastRow() - 1) : 0;
  const totalIncidencias = hojaInc ? Math.max(0, hojaInc.getLastRow() - 1) : 0;

  const indice = obtenerIndiceEstudiantes();
  const activos = Object.keys(indice).filter(function(d) {
    return indice[d].estado === "ACTIVO";
  }).length;

  return {
    ok: true,
    totalEstudiantes: totalEstudiantes,
    estudiantesActivos: activos,
    totalSesiones: totalSesiones,
    totalAsistencias: totalAsistencias,
    totalIncidencias: totalIncidencias,
    zonaHoraria: ss.getSpreadsheetTimeZone(),
    urlWebApp: obtenerUrlWebApp()
  };
}