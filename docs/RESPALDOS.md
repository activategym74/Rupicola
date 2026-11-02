# Respaldos de la base de datos

Cada día a las 3:00 a. m. (hora de Colombia) GitHub copia toda la base de datos de Supabase, la cifra y la guarda 30 días. También se puede ejecutar a mano.

Es gratis: usa GitHub Actions y el plan gratuito de Supabase. Además mantiene el proyecto activo para que Supabase no lo pause por inactividad.

## Configuración (una sola vez)

En GitHub: **Settings → Secrets and variables → Actions → New repository secret**. Cree estos dos secretos:

| Nombre | Valor |
| --- | --- |
| `SUPABASE_DB_URL` | En Supabase: botón **Connect** → **Session pooler** → copie la URI y reemplace `[YOUR-PASSWORD]` por la contraseña de la base de datos. Si no la recuerda, cámbiela en **Project Settings → Database → Reset database password** (la app no usa esa contraseña, no se afecta nada). |
| `BACKUP_PASSPHRASE` | Una clave larga que usted invente (mínimo 20 caracteres). **Guárdela en un lugar seguro**: sin ella los respaldos no se pueden abrir. |

Use la conexión **Session pooler** y no la "Direct connection": GitHub no puede conectarse a la directa.

## Ejecutar un respaldo a mano

GitHub → pestaña **Actions** → **Respaldo diario** → **Run workflow**.

## Descargar un respaldo

GitHub → **Actions** → **Respaldo diario** → abra una ejecución con ✓ verde → al final, en **Artifacts**, descargue `rupicola-respaldo-AAAA-MM-DD`. Viene en un .zip; adentro está el archivo `.tar.gz.gpg` cifrado.

## Restaurar

Solo si se perdió información. Hágalo con apoyo técnico: restaurar reemplaza los datos.

1. Descifrar (pide la `BACKUP_PASSPHRASE`):
   ```bash
   gpg -o respaldo.tar.gz -d rupicola-respaldo-AAAA-MM-DD.tar.gz.gpg
   tar -xzf respaldo.tar.gz
   ```
2. Restaurar en un proyecto de Supabase **nuevo y vacío** (más seguro que sobrescribir el actual), con su cadena de conexión:
   ```bash
   psql --single-transaction --variable ON_ERROR_STOP=1 \
     --file respaldo/roles.sql --file respaldo/schema.sql \
     --command 'SET session_replication_role = replica' \
     --file respaldo/data.sql --dbname "postgresql://...nuevo-proyecto..."
   ```
3. Cambiar en Netlify `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` por los del proyecto nuevo y volver a desplegar.

Guía oficial: https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore

## Qué incluye y qué no

- Incluye: todas las tablas (ventas, pagos, inventario, clientes, auditoría…), usuarios y roles.
- No incluye: los archivos subidos a Storage (fotos de productos, logo, evidencias de entrega). Se pueden volver a subir.
- GitHub avisa por correo si un respaldo falla.
