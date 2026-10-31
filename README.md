# RUPÍCOLA

Plataforma integral de gestión para RUPÍCOLA: restaurante, bar, cafetería, tienda de camisas personalizadas y domicilios, en una sola aplicación web responsive (computador, tablet y celular).

Las dos unidades de negocio (**Gastronomía** y **Tienda**) comparten la plataforma pero mantienen separados sus ingresos, costos, gastos, inventarios y estadísticas. Un cliente puede comprar de ambas en una sola cuenta y un solo pago; el sistema reparte internamente cada peso a su unidad.

## Módulos

| Módulo | Ruta | Qué hace |
|---|---|---|
| Inicio de sesión | `/login`, `/recuperar`, `/restablecer` | Supabase Auth, recuperación por correo, registro de inicio y cierre de sesión |
| Dashboard | `/dashboard` | Ventas del día y mes, ingresos por unidad, gastos, resultado estimado, pedidos activos, cocina, domicilios, mesas, caja, inventario bajo, 9 gráficos, filtros por fecha y unidad |
| Punto de venta | `/pos` | Mostrador, mesa o para llevar; búsqueda por nombre/código, lector de código de barras; variantes y personalización; descuentos y promociones; anulación con permiso y motivo; dividir y unificar cuentas; propinas; pagos mixtos; comprobante imprimible |
| Mesas | `/mesas` | Plano en tiempo real con 7 estados, solicitudes de clientes, entrega de platos, cambio de mesa, QR por mesa |
| Cocina · Bar · Café (KDS) | `/cocina/[estación]` | Cada estación recibe solo lo suyo; aceptar, rechazar con motivo, preparar, listo; semáforo de tiempo |
| Menú QR | `/m/[token]` | Público, sin app: menú con fotos, 3D, personalización, carrito, llamar mesero, servilletas, asistencia, pedir la cuenta, estado del pedido |
| Tienda en línea | `/tienda/[slug]` | Pedidos desde casa: gastronomía + camisas en un carrito, mapa, zonas de cobertura, domicilio o recoger, direcciones frecuentes |
| Seguimiento | `/pedido/[token]` | Línea de tiempo del pedido y ubicación del domiciliario (si comparte, con consentimiento) |
| Domicilios | `/domicilios` | Bandejas por estado, confirmar, costo de envío, asignar domiciliario, historial con fecha, hora y usuario |
| Domiciliario | `/domiciliario` | Interfaz móvil: llamar, navegar, recogido, en camino, entregado con cobro en efectivo, novedades, evidencia fotográfica, historial |
| Catálogo | `/catalogo` | Categorías, productos, precios, estaciones, fotos, modelos 3D (GLB/glTF), variantes de tienda, recetas, personalización |
| Inventario | `/inventario` | Ingredientes y variantes por unidad; entradas, ajustes, mermas, desperdicios, vencimientos; libro de movimientos |
| Compras | `/compras` | Proveedores, órdenes, recepción parcial, facturas, cuentas por pagar, pagos |
| Clientes | `/clientes` | Base central con historial presencial y domicilios; puntos de fidelización activables |
| Caja | `/caja` | Apertura, ingresos, egresos, retiros, reversos, arqueo y cierre con diferencia; por método y por unidad |
| Gastos | `/gastos` | Gastos por unidad o compartidos con % configurable; resultado operativo estimado |
| Reportes | `/reportes` | 16 reportes con filtro de fecha y unidad; exportación a Excel y PDF |
| Auditoría | `/auditoria` | Quién, cuándo, qué, valor anterior y nuevo, motivo |
| Usuarios y roles | `/usuarios` | 11 roles iniciales, roles personalizados, invitación por correo, desactivación inmediata |
| Configuración | `/configuracion` | Establecimiento, logo, colores, horarios, mesas, estaciones, métodos de pago, zonas y tarifas de domicilio, propinas, política de inventario, notificaciones |

## Arquitectura

- **Frontend:** Next.js 15 (App Router) + React 19 + Tailwind CSS 4, Recharts, Leaflet/OpenStreetMap, `@google/model-viewer`.
- **Backend:** Supabase (PostgreSQL, Auth, Realtime, Storage).
- **Reglas de negocio en la base de datos.** Toda operación con efectos (vender, cobrar, anular, mover inventario, cerrar caja, cambiar estados) es una función PL/pgSQL `security definer` que valida permisos, aplica la regla completa en una transacción y deja trazabilidad. La interfaz no puede saltarse una regla.
- **Multi-establecimiento (listo para SaaS).** Cada tabla lleva `business_id` y Row Level Security aísla los datos por establecimiento.

Ver [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md) para el modelo de datos y los flujos conectados.

## Puesta en marcha

### 1. Supabase

```bash
npx supabase@2 link --project-ref <su-proyecto>
npx supabase@2 db push        # aplica supabase/migrations
```

En el panel de Supabase:
- **Authentication → Providers → Email:** desactive “Allow new users to sign up” (los usuarios se crean por invitación).
- **Authentication → URL configuration:** agregue `https://<su-dominio>/auth/callback` a las URLs de redirección.

### 2. Variables de entorno

Copie `.env.example` a `.env.local` y complete. Las integraciones externas son opcionales y **no se simulan**:

| Integración | Variables | Sin configurar |
|---|---|---|
| Supabase | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | La app no funciona |
| Pagos en línea (Wompi) | `NEXT_PUBLIC_WOMPI_PUBLIC_KEY`, `WOMPI_INTEGRITY_SECRET`, `WOMPI_EVENTS_SECRET` | No se ofrece “Pago en línea”; los pagos se registran en caja |
| WhatsApp Business Platform | `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, plantilla aprobada | Los mensajes quedan “omitidos”, nunca “enviados” |
| Envío de cola de WhatsApp | `CRON_SECRET` + un cron que llame `POST /api/notifications/dispatch` | No se procesa la cola |
| Mapas | `NEXT_PUBLIC_MAP_TILES_URL` (opcional) | Usa OpenStreetMap |

Webhook de Wompi: `https://<su-dominio>/api/payments/wompi/webhook`.

### 3. Ejecutar

```bash
npm install
npm run dev
```

Abra `/login`. El primer usuario (créelo en Supabase → Authentication → Add user) entra a **Configuración inicial**, que crea el establecimiento con sus dos unidades, estaciones (Cocina, Bar, Cafetería), las 9 categorías iniciales, los 11 roles, métodos de pago y la caja principal. Ese usuario queda como Administrador general.

## Pruebas

Las reglas de negocio tienen una prueba de extremo a extremo en SQL que se ejecuta sobre PostgreSQL:

```bash
PGHOST=... PGPORT=... PGUSER=postgres supabase/tests/run.sh
```

Cubre, entre otros: la venta mixta del ejemplo (hamburguesa $28.000 + café $8.000 + camisa $55.000 = $91.000, pagada $40.000 en efectivo + $51.000 con tarjeta → $36.000 a Gastronomía y $55.000 a Tienda), descuento de receta y de la variante correcta, pedido QR que llega a cocina, permisos por estación, cuenta dividida, propina separada, reverso de pago, prohibición de borrar pagos, domicilio con zona de cobertura y cobro contra entrega, gasto compartido 70/30 y aislamiento entre establecimientos.

## Notas

- El comprobante de venta es interno; no reemplaza la factura electrónica de la DIAN, que requiere un proveedor tecnológico autorizado (integración pendiente).
- Los indicadores de rentabilidad son administrativos y estimados; no son estados financieros ni contabilidad oficial.
