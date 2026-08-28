# Cotizador de Auditorías en PDV

Sistema web para generar cotizaciones estimadas de servicios de auditoría en puntos de venta (PDV). Hecho con **HTML, CSS y JavaScript puro** (sin frameworks, sin backend). Toda la información (configuración de costos e historial de cotizaciones) se guarda en el `localStorage` del navegador.

> ⚠️ **Importante:** todos los precios incluidos en este proyecto son **VALORES DE EJEMPLO**. No representan tarifas reales de mercado. Debe reemplazarlos por sus propios valores desde la sección "Configuración de costos" antes de usar el sistema con clientes reales.

---

## Contenido del proyecto

```
pdv-cotizador/
├── index.html     -> estructura de la aplicación (formularios, vistas, modal)
├── styles.css      -> estilos visuales (colores, layout, responsive)
├── app.js          -> toda la lógica: cálculo, configuración, historial, PDF
└── README.md       -> este archivo
```

---

## 1. Cómo abrir el sistema localmente

No necesita instalar nada ni tener un servidor.

1. Descargue o clone la carpeta del proyecto completa.
2. Haga doble clic en `index.html`, o ábralo desde su navegador (`Archivo > Abrir archivo`).
3. El sistema funcionará directamente en el navegador. La primera vez, se cargará automáticamente una configuración de costos de ejemplo.

**Recomendación:** use Google Chrome, Microsoft Edge o Firefox actualizados para mejor compatibilidad con `localStorage` y con la generación de PDF.

---

## 2. Cómo modificar los colores

Todos los colores del sistema están centralizados en la parte superior del archivo `styles.css`, dentro del bloque `:root`:

```css
:root {
  --color-primary: #12233f;   /* color principal (menú, encabezados) */
  --color-accent:  #c99a3c;   /* color de acento (totales, detalles) */
  --color-success: #1f8a5f;
  --color-warning: #b8860b;
  --color-danger:  #b3261e;
  --color-bg:      #f4f6f9;   /* fondo general */
  --color-surface: #ffffff;   /* fondo de tarjetas */
  ...
}
```

Para cambiar la identidad visual del sistema, edite únicamente estos valores (códigos de color en formato hexadecimal). No es necesario modificar ninguna otra parte del CSS ni del HTML.

---

## 3. Tipos de servicio: Auditoría en PDV y Mystery Shopper

El sistema maneja dos tipos de servicio, cada uno con su propio formulario de cotización y su propia sección de configuración de costos. Al elegir el "Tipo de servicio" en **Nueva cotización**, el formulario cambia automáticamente para pedir los datos correctos de cada uno.

### 3.1. Auditoría en punto de venta

Vaya al menú lateral y haga clic en **"Configuración de costos"**, y despliegue el panel **"🔍 Auditoría en punto de venta"**. Desde ahí puede configurar:

- **Escalas de precio por PDV:** agregar, editar o eliminar rangos de PDV con su **precio base**, la **cantidad de productos incluidos** en ese precio (cada escala puede definir la suya) y sus límites mínimo/máximo. El sistema le avisará si dos escalas se superponen o si queda un rango de PDV sin cubrir.
- **Modalidad de cálculo:**
  - *Precio cerrado por escala*: se cobra el precio fijo configurado para todo el rango.
  - *Precio progresivo*: el precio se interpola proporcionalmente entre el límite de una escala y el de la siguiente.
- **Parámetros generales:** recargo por producto adicional, recargos por zona, capacidad de PDV por auditor, costos de traslado/viáticos/alojamiento, costo de servicios adicionales (evidencia fotográfica, informe, dashboard, presentación).
- **Mano de obra (horas hombre):** costo por hora hombre, horas dedicadas por visita, **Aguinaldo (%)** e **IPS patronal (%)**. Con estos valores el sistema calcula automáticamente el costo real de la mano de obra (incluyendo cargas sociales) y lo suma a cada cotización.

**Lógica de cálculo (resumen):**

1. Se determina la cantidad de **ciclos de servicio** según la frecuencia (única, semanal, quincenal, mensual) y la duración en meses.
2. Se busca el **precio base** según la escala de PDV correspondiente (cerrado o progresivo).
3. Se suman los **recargos** por productos adicionales y visitas adicionales, y se multiplica por la cantidad de ciclos.
4. Se agrega el **recargo de zona**. Si la zona es "Combinada", se reparte la cantidad de PDV entre Asunción, Gran Asunción e Interior, y se calcula un recargo ponderado según qué proporción de PDV cae en cada una.
5. Se calculan los **costos operativos** (traslado, viáticos, alojamiento), los **servicios adicionales** de cargo único (fotografía, informe, dashboard, presentación) y el **costo de mano de obra** (horas hombre × costo por hora, con aguinaldo e IPS patronal incluidos).
6. Si la cantidad de PDV supera la escala máxima configurada, el sistema muestra la advertencia **"Este servicio requiere una cotización personalizada"** y calcula un valor orientativo extrapolado.
7. Además del total, se muestra un **costo mensual estimado** (total ÷ duración en meses).

### 3.2. Mystery Shopper

Despliegue el panel **"🕵️ Mystery Shopper"** en Configuración de costos. Este servicio está pensado para monitorear competencia de cualquier tipo de negocio (aseguradoras, bancos, retail, restaurantes, etc.) mediante visitas presenciales y canales remotos (WhatsApp, Redes Sociales, Web). Se puede configurar:

- **Trabajo de campo:** horas de traslado, espera/interacción y carga de informe por visita presencial, y la jornada efectiva diaria de un mystery shopper.
- **Canales remotos:** tiempo de gestión por cada interacción remota.
- **Coordinación y análisis:** horas de diseño de guion/briefing y de análisis/armado del informe final (tareas únicas del proyecto).
- **Costos unitarios:** costo por hora del mystery shopper, costo por hora del analista/coordinador, y viático de movilidad por visita.

**Lógica de cálculo (resumen):**

1. **Trabajo de campo:** horas por visita = traslado + espera + carga de informe. Visitas totales = sucursales × rondas. Con la jornada efectiva se calcula cuántas visitas puede hacer un shopper por día, cuántos días necesita una sola persona, y cuántos **mystery shoppers se necesitan** para cumplir el plazo deseado.
2. **Viáticos:** visitas totales × viático por visita.
3. **Canales remotos:** interacciones totales = empresas a monitorear × canales remotos × rondas; se multiplican por el tiempo de gestión y el costo por hora.
4. **Coordinación y análisis:** horas de diseño de guion + horas de análisis, al costo por hora del analista/coordinador (cargo único del proyecto).
5. Se suman mano de obra (campo + remoto + coordinación) y viáticos, y sobre ese subtotal se aplican el **margen de ganancia**, el **descuento** y el **IVA** (los mismos parámetros comerciales de la sección "Comercial", compartidos entre ambos servicios).

Al ser un proyecto puntual (no recurrente mes a mes), este servicio no muestra un "costo mensual estimado"; en cambio, destaca la **dotación de campo necesaria** (cantidad de mystery shoppers) y el costo promedio por sucursal y por empresa monitoreada.

### 3.3. Común a ambos servicios

- **Comercial (aplica a todos los servicios):** margen de ganancia (%), IVA (%) y descuento máximo permitido (%) — compartidos entre Auditoría y Mystery Shopper.
- **Ayuda contextual:** cada campo de la aplicación (Nueva cotización, Cálculo rápido y Configuración de costos) tiene un ícono "ⓘ" al lado. Al hacer clic muestra una explicación de qué significa el campo y cómo se usa en el cálculo, pensado para que cualquier persona del equipo pueda usar el sistema sin dudas.
- Todos los montos en guaraníes se muestran y se escriben con separador de miles (por ejemplo `10.000.000`) en toda la sección de configuración y en el formulario de cotización.
- **Restaurar valores de ejemplo:** vuelve a cargar la configuración original de demostración (pide confirmación).
- **Exportar configuración:** descarga un archivo `.json` con toda su configuración actual (de ambos servicios), útil como respaldo.
- **Importar configuración:** permite cargar un archivo `.json` exportado previamente (pide confirmación, ya que reemplaza la configuración actual).

Todos los cambios se guardan automáticamente en `localStorage` al presionar "Guardar configuración", por lo que persisten aunque cierre o actualice la página (en el mismo navegador y equipo).

---

## 4. Uso general del sistema

- **Nueva cotización:** elija el "Tipo de servicio" (Auditoría en PDV o Mystery Shopper) — el formulario cambia automáticamente para pedir los datos de ese servicio. Complete los datos del cliente y del servicio, y presione "Calcular cotización". Podrá ver el desglose completo (incluyendo el **margen de ganancia** en guaraníes), guardar la cotización en el historial, generar una vista previa, imprimir o descargar el PDF (versión cliente, sin margen de ganancia, o versión interna, con el desglose completo).
- **Cálculo rápido:** pensado para usar durante una reunión con el cliente, cuando se necesita un número aproximado al instante para una Auditoría en PDV. Solo pide los datos mínimos (PDV, productos, zona, etc.) y muestra el total estimado junto con el margen de ganancia. Desde ahí puede presionar "Usar estos datos en cotización completa" para continuar armando la cotización oficial con esos mismos valores ya cargados.
- **Historial de cotizaciones:** liste, busque y filtre todas las cotizaciones guardadas (de ambos servicios) por cliente, número, estado, zona o fecha. La columna "Servicio" indica de qué tipo es cada una. Desde ahí puede ver, editar, duplicar, descargar en PDF o eliminar una cotización, y cambiar su estado (Borrador, Enviada, Aprobada, Rechazada, Vencida).
- **Numeración automática:** cada cotización guardada recibe un número correlativo con el formato `COT-AAAA-001`, independientemente del tipo de servicio.

---

## 5. Cómo subir el proyecto a GitHub

1. Cree un repositorio nuevo en GitHub (por ejemplo, `cotizador-pdv`).
2. En su computadora, dentro de la carpeta del proyecto, ejecute:

   ```bash
   git init
   git add .
   git commit -m "Primera versión del cotizador de auditorías en PDV"
   git branch -M main
   git remote add origin https://github.com/SU_USUARIO/cotizador-pdv.git
   git push -u origin main
   ```

   (Reemplace `SU_USUARIO` y el nombre del repositorio por los suyos).

---

## 6. Cómo publicarlo gratuitamente con GitHub Pages

1. Ingrese a su repositorio en GitHub.
2. Vaya a **Settings** (Configuración) > **Pages** (menú lateral izquierdo).
3. En **"Build and deployment"**, seleccione como origen (**Source**) la opción **"Deploy from a branch"**.
4. Elija la rama **`main`** y la carpeta **`/ (root)`**, luego presione **Save**.
5. Espere uno o dos minutos. GitHub le mostrará un enlace similar a:

   ```
   https://SU_USUARIO.github.io/cotizador-pdv/
   ```

6. Abra ese enlace: el sistema quedará disponible públicamente y de forma gratuita, funcionando igual que en su computadora (toda la información seguirá guardándose en el `localStorage` del navegador de cada persona que lo use, de forma independiente).

---

## Notas técnicas

- No se utilizan frameworks (React, Vue, etc.) ni Node.js. Solo HTML5, CSS3 y JavaScript puro.
- La única librería externa es **jsPDF**, cargada por CDN (`cdnjs.cloudflare.com`) para la generación de los PDF.
- No hay backend ni base de datos: toda la información se guarda localmente en el navegador mediante `localStorage`. Si necesita compartir el historial entre varios equipos, use los botones "Exportar configuración" y, para cotizaciones puntuales, la descarga en PDF.
- El código está organizado por secciones claramente comentadas en `app.js`: almacenamiento, cálculo, validaciones, navegación y cada vista (Nueva cotización, Configuración, Historial).
