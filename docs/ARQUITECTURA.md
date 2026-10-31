# Arquitectura de RUPÍCOLA

## Principios

1. **Una sola fuente de verdad.** Existencias, ingresos y saldos se derivan de libros de movimientos que no se pueden borrar (`inventory_movements`, `payments`, `payment_allocations`, `revenue_entries`, `cash_movements`). Las correcciones son reversos con motivo.
2. **Reglas en la base de datos.** El frontend llama funciones RPC; cada una valida permisos (`require_perm`), opera en una transacción y registra auditoría. Varios usuarios pueden trabajar a la vez sin descuadres.
3. **Aislamiento por establecimiento.** `business_id` en todas las tablas + RLS (`is_member`, `has_perm`).
4. **Tiempo real.** Supabase Realtime sobre `orders`, `order_items`, `kds_tickets`, `dining_tables`, `service_requests`, `deliveries`, `notifications`, `courier_locations`.
5. **Integraciones honestas.** Pagos en línea, WhatsApp y mapas se activan por variables de entorno. Nada se marca como pagado o enviado sin confirmación del proveedor.

## Modelo de datos (resumen)

```
businesses ─┬─ business_units (gastronomy | shop, % de gastos compartidos)
            ├─ roles ── role_permissions ── permissions
            ├─ members (usuario ↔ establecimiento, rol, activo)
            ├─ stations (kitchen, bar, cafe)
            ├─ categories ── products ─┬─ product_variants (talla/color/diseño, existencia propia)
            │                          ├─ recipe_items ── ingredients
            │                          └─ modifier_groups ── modifier_options (± ingrediente)
            ├─ inventory_movements (libro; actualiza ingredients.stock / product_variants.stock)
            ├─ dining_tables (qr_token, estado)
            ├─ customers ── customer_addresses
            ├─ orders ─┬─ order_items (unidad, estación, ticket, costo congelado)
            │          ├─ kds_tickets (uno por estación y ronda)
            │          ├─ payments ── payment_allocations (reparto por unidad)
            │          ├─ revenue_entries (ingreso y costo reconocidos por unidad)
            │          ├─ deliveries ── delivery_events, courier_locations
            │          └─ order_status_history
            ├─ service_requests (llamar mesero, cuenta…)
            ├─ cash_registers ── cash_sessions ── cash_movements (por unidad y método)
            ├─ suppliers ── purchases ── purchase_items, purchase_payments
            ├─ expense_categories ── expenses ── expense_allocations
            ├─ notifications (personal), notification_outbox (WhatsApp), push_subscriptions
            └─ audit_log
```

## Flujos conectados

| Evento | Qué ocurre automáticamente |
|---|---|
| Se agrega un producto a una cuenta | Precio y costo se toman del catálogo (nunca del cliente). Se valida existencia de la variante. |
| Se envía el pedido | Se crea un ticket por estación (cocina, bar, cafetería). Productos de tienda no van a cocina. Notificación a la estación. Mesa pasa a “Pedido pendiente”. |
| Cocina cambia el estado | Pedido, mesa y domicilio se sincronizan. Al quedar listo se notifica al mesero o a domicilios. Un rechazo exige motivo, anula las líneas y devuelve inventario. |
| Se registra un pago | Cada pago se reparte entre Gastronomía, Tienda, domicilio y propina de forma exacta (acumulada). Se crea un movimiento de caja por unidad y método. Se actualiza el saldo. |
| El pedido queda pagado | Se reconocen ingresos y costo por unidad, se descuenta inventario (receta o variante, según política), se actualizan cliente y puntos, y se libera la mesa. |
| Se reversa un pago | Asignaciones y caja en negativo; si estaba cerrado, se reversan los ingresos y la cuenta vuelve a quedar por cobrar. |
| Llega un pedido en línea | Cliente y dirección se guardan; se valida zona de cobertura y pedido mínimo; aparece en Domicilios. Cocina lo recibe al confirmarlo. |
| Se asigna domiciliario | Notificación al domiciliario; el seguimiento del cliente muestra el estado. |
| El domiciliario entrega | Registra hora; si hay cobro en efectivo se crea el pago y se cierra el pedido. Cada cambio encola un mensaje de WhatsApp. |
| Se recibe una compra | Entra al inventario de la unidad; el costo del ingrediente se recalcula por promedio ponderado. |
| Se registra un gasto compartido | Se asigna a cada unidad según el porcentaje configurado (o el indicado en el gasto). |

## Seguridad

- Lectura: miembros activos del establecimiento, con restricciones adicionales para datos sensibles (pagos, caja, clientes, compras, gastos, auditoría).
- Escritura transaccional: solo vía funciones. Tablas transaccionales tienen trigger que impide `DELETE`.
- Domiciliario: solo ve los domicilios asignados.
- Clientes anónimos: solo funciones públicas (`public_menu`, `qr_place_order`, `shop_place_order`, `public_track`…) que exponen lo mínimo. El seguimiento usa un token aleatorio de 128 bits.
- `gateway_confirm_payment` solo la puede ejecutar el servidor (service role) tras verificar la firma del evento de Wompi.

## Próximas fases sugeridas

- Facturación electrónica DIAN mediante proveedor tecnológico.
- Restringir usuarios a una sola unidad de negocio (p. ej. administrador de tienda solo ve tienda) en reportes y dashboard.
- Notificaciones Web Push con service worker (la tabla `push_subscriptions` ya existe).
- Límite de solicitudes en las funciones públicas (protección contra abuso).
