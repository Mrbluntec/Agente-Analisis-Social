# Integración con Instagram

Investigación del 2026-11-18 sobre la documentación oficial de Meta. Los puntos marcados **sin verificar** deben confirmarse al implementar.

## Fuentes

- Visión general: https://developers.facebook.com/docs/instagram-platform/overview
- Login con Instagram: https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login
- Facebook Login for Business: https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/business-login-for-instagram
- Insights de cuenta: https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/insights
- Insights de media: https://developers.facebook.com/docs/instagram-platform/reference/instagram-media/insights
- Guía de insights: https://developers.facebook.com/docs/instagram-platform/insights
- Business Discovery: https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/business_discovery
- Webhooks: https://developers.facebook.com/docs/instagram-platform/webhooks
- Device Login: https://developers.facebook.com/docs/facebook-login/for-devices

## 1. Vía de acceso

| | Login con Instagram | Facebook Login for Business |
| --- | --- | --- |
| Cuenta | Profesional (Business o Creator) | Profesional vinculada a una Página de Facebook |
| Host | graph.instagram.com | graph.facebook.com |
| Permisos | `instagram_business_*` | `instagram_basic`, `instagram_manage_insights`, `pages_show_list`, `pages_read_engagement` (+ `ads_read` si el rol viene de Business Manager) |
| Business Discovery (competidores) | No | Sí |
| Webhook `story_insights` | No | Sí |

Las cuentas personales no funcionan en ninguna. **Propuesta: Facebook Login for Business**, porque es la única con competidores.

## 2. OAuth

**Facebook Login for Business**
- Autorización: `https://www.facebook.com/v27.0/dialog/oauth` con `config_id` o `scope`.
- Canje: `GET graph.facebook.com/v27.0/oauth/access_token` (code → token) y `grant_type=fb_exchange_token` (token largo, unos 60 días).
- Cuenta IG: `instagram_business_account` de la Página vía `GET /me/accounts`.
- **Sin verificar**: detalle exacto de estos endpoints.

**Login con Instagram** (referencia)
- Autorización: `https://www.instagram.com/oauth/authorize?client_id=...&redirect_uri=...&response_type=code&scope=...&state=...`
- Token corto: `POST https://api.instagram.com/oauth/access_token`.
- Token largo (60 días): `GET https://graph.instagram.com/access_token?grant_type=ig_exchange_token`.
- Refresh: `GET https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token`, solo con más de 24 h y antes de vencer.
- **Sin verificar**: nombre exacto `instagram_business_manage_insights` y duración del token corto.

## 3. Insights de la cuenta propia

- API v27.0. `impressions` de cuenta retirada el 21-04-2025: usar `views`.
- Cuenta: `GET /<IG_USER_ID>/insights` con `reach`, `views`, `accounts_engaged`, `total_interactions`, `likes`, `comments`, `saves`, `shares`, `replies`, `reposts`, `profile_links_taps`, `follows_and_unfollows`.
- Demografía: `follower_demographics`, `engaged_audience_demographics` (edad, ciudad, país, género; top 45; mínimo 100 seguidores).
- Media: FEED `reach`, `views`, `likes`, `comments`, `saved`, `shares`, `total_interactions`, `profile_visits`, `follows`. REELS añade tiempo de visualización y `reels_skip_rate`. STORY: `reach`, `views`, `replies`, `navigation`, `link_clicks`.
- Retención en Meta: cuenta 90 días, media 2 años, **historias 24 horas**.
- Retraso de datos: hasta 48 h.
- Rate limit: por app y usuario, ventana móvil de 24 h.

### Qué significa "en vivo"

No hay streaming de métricas. Cadencia propuesta:

| Dato | Frecuencia |
| --- | --- |
| Insights de cuenta | Cada 1-3 h |
| Media de los últimos 7 días | Cada 1-2 h |
| Media antigua | Diaria |
| Historias | Cada hora + webhook |
| Demografía | Diaria |
| Competidores | Cada 6-12 h |
| Comentarios y menciones | Webhook |

El histórico largo debe vivir en nuestra base, porque Meta lo borra.

## 4. Competidores (máximo 5)

`GET /<NUESTRO_IG_ID>?fields=business_discovery.username(<competidor>){followers_count,media_count,media{id,caption,media_type,timestamp,permalink,like_count,comments_count,view_count}}`

- Solo con Facebook Login.
- El competidor debe ser cuenta profesional.
- Disponible: seguidores, nº de publicaciones, likes, comentarios y vistas por publicación.
- No disponible: alcance, demografía, historias, insights.
- **Sin verificar**: límites numéricos y comportamiento cuando el competidor oculta likes.
- El scraping viola los términos de Meta: descartado.

## 5. App Review

- Acceso estándar: suficiente para cuentas propias con rol en la app (testers). **Las cuentas de MOGA no necesitan revisión.**
- Acceso avanzado: para clientes externos. Requiere App Review por permiso y verificación de negocio, con screencast, política de privacidad, URL de borrado de datos y cuenta de prueba.
- Plazo habitual de 1 a 4 semanas (**sin verificar**: Meta no publica plazos).

## 6. Inicio de sesión web y CLI

Ambos comparten el mismo almacén de tokens en el servidor.

- **Web**: `/auth/instagram/start` genera `state` y redirige a Meta; el callback HTTPS canjea el código, cifra el token, lo guarda y vuelve a la app.
- **CLI**: `atalaya login` llama a `POST /auth/cli/start`, abre el navegador con el flujo web y consulta `GET /auth/cli/poll` cada 2-5 s (caduca a los 10 min). Recibe un token de Atalaya; el de Meta nunca sale del servidor.
- Descartado: callback en localhost (Meta exige coincidencia exacta y HTTPS; **sin verificar** si acepta localhost) y Device Login (**sin verificar** que admita permisos de Instagram).
- Desarrollo local: túnel HTTPS con ngrok o Cloudflare Tunnel.

## 7. Arquitectura propuesta

Tablas: `ig_connections` (token cifrado, caducidad, permisos), `ig_account_snapshots`, `ig_media`, `ig_media_insight_snapshots`, `ig_story_insights`, `ig_demographics`, `competitors` (máx. 5), `competitor_snapshots`, `competitor_media_snapshots`, `webhook_events`, `oauth_states`, `cli_login_sessions`, `ingest_runs`.

Tareas: refresco diario de tokens que venzan en menos de 15 días, ingesta según la tabla de cadencia, backoff según las cabeceras `X-Business-Use-Case-Usage` y `X-App-Usage`.

## 8. Pasos para el Señor

1. Crear una app de tipo Business en developers.facebook.com.
2. Agregar Facebook Login for Business e Instagram.
3. Configurar la URI de redirección HTTPS exacta.
4. Agregar testers y confirmar que la cuenta IG de MOGA es profesional y está vinculada a su Página.
5. Configurar política de privacidad, URL de borrado de datos y webhook HTTPS.
6. Pasar los 5 usuarios de Instagram de la competencia.
