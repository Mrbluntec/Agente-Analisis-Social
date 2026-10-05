# Atalaya

Nombre en clave de la plataforma de analítica social de MOGA Agencia Digital: seis redes, un almacén propio de métricas y un agente de IA sobre Ollama Cloud. Este repositorio contiene los cimientos de la fase 1, la aplicación web y el servidor del agente. El agente ya es real y usa su clave de Ollama Cloud; los datos que consulta siguen siendo de muestra, porque aún no hay conexión con las redes.

## Qué hay

| Ruta | Contenido | Estado |
| --- | --- | --- |
| `api/openapi.yaml` | Contrato de la API de la fase 1: 26 rutas, 31 operaciones | Validado con Redocly |
| `db/migrations/0001_core.sql` | Organizaciones, usuarios, marcas, cuentas, publicaciones, claves de Ollama | Aplicado en PostgreSQL 16 |
| `db/migrations/0002_metrics_agent.sql` | Diccionario de métricas, fotos de métricas, agente, briefings, alertas | Aplicado en PostgreSQL 16 |
| `db/migrations/0003_timescale.sql` | Hipertablas y compresión | **Sin probar**: requiere TimescaleDB |
| `db/tests/smoke.sql` | Diez comprobaciones de restricciones | Pasa |
| `packages/tokens/tokens.json` | Tokens de diseño, temas oscuro y claro | Fuente única |
| `packages/tokens/build.mjs` | Genera `dist/tokens.css` | Ejecutado |
| `apps/web` | Aplicación web: Inicio, Resumen, Contenido y Agente | Compila sin errores de tipos; revisada en Chromium |
| `apps/api` | Servidor del agente: claves, modelos, cola y ejecuciones con streaming | 11 pruebas pasan |
| `packages/core` | Datos de muestra, analítica y tipos compartidos | Usado por web y servidor |
| `docs/enlaces.md` | Enlaces al plan, al prototipo, al sistema de diseño y a la vista publicada | — |

## Cómo comprobarlo

```sh
# Base de datos (PostgreSQL 16 o posterior)
createdb atalaya
psql -v ON_ERROR_STOP=1 -d atalaya -f db/migrations/0001_core.sql
psql -v ON_ERROR_STOP=1 -d atalaya -f db/migrations/0002_metrics_agent.sql
psql -v ON_ERROR_STOP=1 -d atalaya -f db/tests/smoke.sql      # debe terminar con «smoke ok»

# Contrato
npx @redocly/cli lint api/openapi.yaml

# Tokens
node packages/tokens/build.mjs
```

## Arrancar la aplicación

Hace falta Node 20 o posterior. Desde la raíz del repositorio:

```sh
npm run setup      # instala las dependencias del servidor y de la web (una sola vez)
npm run dev        # servidor en http://localhost:8787 y web en http://localhost:5173
```

Abra http://localhost:5173, vaya a **Agente** y pulse **Conectar clave**. La clave se crea en https://ollama.com/settings/keys. Al guardarla, el servidor la comprueba con Ollama y la deja cifrada en `apps/api/.data/`, que no entra en el repositorio.

Otras órdenes:

- `npm test` ejecuta las pruebas del servidor contra un Ollama de mentira.
- `npm run build` comprueba los tipos de la web y la compila a `apps/web/dist/`.
- En `apps/web`: `npm run types` regenera los tipos desde `api/openapi.yaml`, y `node scripts/single-file.mjs` empaqueta la web compilada en un solo archivo.
- Para probar el circuito sin clave ni créditos: `node apps/api/scripts/fake-ollama.mjs` en una terminal y `OLLAMA_BASE_URL=http://localhost:11500 npm run dev` en otra. Acepta cualquier clave que empiece por «demo».

### Qué es real y qué es de muestra

| Parte | Estado |
| --- | --- |
| Agente: razonamiento, herramientas, respuesta y citas en streaming | Real. Llama a Ollama Cloud con su clave |
| Lista de modelos | Real. Se descubre en Ollama y solo incluye los que declaran visión, herramientas y razonamiento |
| Claves: comprobación, cifrado, clave de agencia y personal | Real |
| Cola por clave y cancelación | Real, en memoria |
| Datos que el agente consulta | De muestra: la marca ficticia de `packages/core/src/sample.ts` |
| Inicio, Resumen y Contenido | De muestra, calculados en el navegador |
| Conversaciones y ejecuciones | En memoria; se pierden al reiniciar el servidor |
| Inicio de sesión | No hay: el servidor atiende a un único usuario local |

Si la web no encuentra el servidor, sigue funcionando con un agente simulado y lo indica en pantalla. Así se comporta la vista publicada.

### Cómo está organizado

- `packages/core`: datos de muestra, cálculos de analítica, formato de cifras y tipos del contrato. Lo comparten la web y el servidor.
- `apps/api`: servidor (Hono). `src/ollama.ts` habla con Ollama, `src/keys.ts` cifra las claves, `src/agent/` contiene las herramientas, las instrucciones y el bucle del agente, y `src/app.ts` las rutas.
- `apps/web`: la aplicación. `src/api/live.ts` llama al servidor; `src/api/mock.ts` es el agente simulado.

Se eligió Vite con React en lugar de Next.js, que era lo previsto en el plan. La API es un servicio aparte, así que la web de la fase 1 no necesita servidor propio; el renderizado en servidor solo hace falta para los reportes compartidos de la fase 2, y los componentes se pueden llevar a Next.js entonces sin reescribirlos.

### Lo que se comprobó y lo que no

- Comprobado contra Ollama Cloud real: la lista de modelos y sus capacidades, y el rechazo de una clave falsa.
- Comprobado contra un Ollama de mentira que habla el mismo protocolo: el circuito completo, de la pregunta a la respuesta citada, en las pruebas y en un navegador.
- **Sin comprobar: una conversación real con una clave válida.** No se dispuso de ninguna. La primera ejecución con su clave es la prueba que falta; si falla, el mensaje en pantalla indica el motivo.

## Lo que la aplicación reveló del contrato

Construir contra el contrato sacó a la luz tres ajustes pendientes en `api/openapi.yaml`:

- **Adjuntos en las respuestas del agente.** La respuesta de muestra incluye un gráfico; `AgentRun` no tiene dónde llevarlo, y el agente real todavía no puede adjuntar ninguno. Hoy vive como extra en `RunView` (`apps/web/src/api/mock.ts`).
- **`up_is_good` en `Kpi`.** Al tener valor por defecto, el generador de tipos lo trata como obligatorio. O se declara obligatorio o se quita el valor por defecto.
- **Lista de pilares y formatos disponibles.** Los filtros de Contenido necesitan saber qué valores existen en el periodo; la ruta de publicaciones no los devuelve.

## Decisiones que el esquema ya toma

- **Todo cuelga de la marca.** Borrar una marca arrastra cuentas, publicaciones y métricas.
- **Fotos, no totales.** Las métricas de cuenta se guardan por día; las de publicación, por instante y acumuladas. De ahí salen el historial y las curvas de vida.
- **Diccionario con vigencia.** Cada métrica tiene su definición propia y la nativa de cada red con fechas, para sobrevivir a que una red retire un campo.
- **Dos claves de Ollama.** La de la agencia cubre las tareas programadas; la personal, opcional, tiene prioridad en el chat. Una activa por alcance, siempre cifrada.
- **Cada cifra del agente es trazable.** `agent_citations` guarda la consulta que produjo cada número de una respuesta.
- **La competencia no lleva token.** Una restricción impide guardar credenciales en una cuenta ajena.

## Lo que falta decidir

- Proveedor de nube y servicio de claves para el cifrado de sobre.
- Si se adopta TimescaleDB desde el inicio o cuando el volumen lo pida.
- Aislamiento entre agencias con seguridad a nivel de fila, antes de abrir el SaaS.
- Dimensión de los vectores para búsqueda semántica; depende del modelo de embeddings.

## Avisos conocidos del linter

Redocly deja dos advertencias, ambas intencionadas y registradas en `.redocly.lint-ignore.yaml`:

- El callback de OAuth solo responde 302: es una redirección.
- `AgentEvent` no se referencia desde ninguna ruta: describe el campo `data` del flujo de eventos, que OpenAPI 3.1 no permite tipar.
