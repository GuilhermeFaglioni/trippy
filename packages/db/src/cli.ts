import { migrate } from './migrate.js'

try {
  const applied = await migrate()
  if (applied.length === 0) console.log('Banco já está atualizado.')
  else console.log(`Migrations aplicadas: ${applied.join(', ')}`)
} catch (error) {
  console.error(error)
  process.exitCode = 1
}
