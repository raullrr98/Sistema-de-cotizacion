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

## 3. Cómo utilizar la configuración de costos

Vaya al menú lateral y haga clic en **"Configuración de costos"**. Desde ahí puede:

- **Escalas de precio por PDV:** agregar, editar o eliminar rangos de PDV con su **precio base**, la **cantidad de productos incluidos** en ese precio (cada escala puede definir la suya) y sus límites mínimo/máximo. El sistema le avisará si dos escalas se superponen o si queda un rango de PDV sin cubrir.
- **Modalidad de cálculo:**
  - *Precio cerrado por escala*: se cobra el precio fijo configurado para todo el rango.
  - *Precio progresivo*: el precio se interpola proporcionalmente entre el límite de una escala y el de la siguiente.
- **Parámetros generales:** recargo por producto adicional, recargos por zona, capacidad de PDV por auditor, costos de traslado/viáticos/alojamiento, costo de servicios adicionales (evidencia fotográfica, informe, dashboard, presentación), **margen de ganancia (%)**, IVA y descuento máximo permitido.
- Todos los montos en guaraníes se muestran y se escriben con separador de miles (por ejemplo `10.000.000`) en toda la sección de configuración y en el formulario de cotización.
- **Restaurar valores de ejemplo:** vuelve a cargar la configuración original de demostración (pide confirmación).
- **Exportar configuración:** descarga un archivo `.json` con toda su configuración actual, útil como respaldo.
- **Importar configuración:** permite cargar un archivo `.json` exportado previamente (pide confirmación, ya que reemplaza la configuración actual).

Todos los cambios se guardan automáticamente en `localStorage` al presionar "Guardar configuración", por lo que persisten aunque cierre o actualice la página (en el mismo navegador y equipo).

### Lógica de cálculo (resumen)

1. Se determina la cantidad de **ciclos de servicio** según la frecuencia (única, semanal, quincenal, mensual) y la duración en meses.
2. Se busca el **precio base** según la escala de PDV correspondiente (cerrado o progresivo).
3. Se suman los **recargos** por productos adicionales y visitas adicionales, y se multiplica por la cantidad de ciclos.
4. Se agrega el **recargo de zona** (Gran Asunción / Interior).
5. Se calculan los **costos operativos** (traslado, viáticos, alojamiento) según la cantidad de auditores y de ciclos, y los **servicios adicionales** de cargo único (fotografía, informe, dashboard, presentación).
6. Se aplica el **margen comercial**, luego el **descuento** (limitado al máximo configurado) y finalmente el **IVA**.
7. Si la cantidad de PDV supera la escala máxima configurada, el sistema muestra la advertencia **"Este servicio requiere una cotización personalizada"** y calcula un valor orientativo extrapolado.

---

## 4. Uso general del sistema

- **Nueva cotización:** complete los datos del cliente y del servicio, y presione "Calcular cotización". Podrá ver el desglose completo (incluyendo el **margen de ganancia** en guaraníes), guardar la cotización en el historial, generar una vista previa, imprimir o descargar el PDF (versión cliente, sin margen de ganancia, o versión interna, con el desglose completo).
- **Cálculo rápido:** pensado para usar durante una reunión con el cliente, cuando se necesita un número aproximado al instante. Solo pide los datos mínimos (PDV, productos, zona, etc.) y muestra el total estimado junto con el margen de ganancia. Desde ahí puede presionar "Usar estos datos en cotización completa" para continuar armando la cotización oficial con esos mismos valores ya cargados.
- **Historial de cotizaciones:** liste, busque y filtre todas las cotizaciones guardadas por cliente, número, estado, zona o fecha. Desde ahí puede ver, editar, duplicar, descargar en PDF o eliminar una cotización, y cambiar su estado (Borrador, Enviada, Aprobada, Rechazada, Vencida).
- **Numeración automática:** cada cotización guardada recibe un número correlativo con el formato `COT-AAAA-001`.

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
