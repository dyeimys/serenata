const fs = require('node:fs')
const path = require('node:path')
const { applicationDefault, initializeApp } = require('firebase-admin/app')
const { FieldValue, getFirestore } = require('firebase-admin/firestore')

function readProjectId() {
  if (process.env.GCLOUD_PROJECT) return process.env.GCLOUD_PROJECT
  if (process.env.GOOGLE_CLOUD_PROJECT) return process.env.GOOGLE_CLOUD_PROJECT

  const firebaseRcPath = path.resolve(__dirname, '..', '..', '.firebaserc')
  const firebaseRc = JSON.parse(fs.readFileSync(firebaseRcPath, 'utf8'))
  const projectId = firebaseRc.projects?.default

  if (!projectId) throw new Error('Projeto Firebase padrao nao encontrado em .firebaserc.')
  return projectId
}

const projectId = readProjectId()

initializeApp({
  credential: applicationDefault(),
  projectId,
})

const weddingProfile = {
  coupleNames: ['Hélder', 'Ana Paula'],
  weddingDate: '2026-07-11',
  ceremonyTime: '16:00',
  city: 'Serranópolis',
  state: 'GO',
  venue: 'Chácara Nova Esperança',
  venueDetails: '1,5 km de Serranópolis/GO',
  expectedGuestCount: null,
  budgetAmount: null,
  budgetCurrency: 'BRL',
  style: 'Romântico floral em tons rosé',
  ceremonyType: 'Cristã',
  priorities: [],
  constraints: [],
  timezone: 'America/Sao_Paulo',
  source: 'wedding-invitation',
  updatedAt: FieldValue.serverTimestamp(),
}

async function seed() {
  const reference = getFirestore().doc('settings/weddingProfile')
  const snapshot = await reference.get()

  if (snapshot.exists && !process.argv.includes('--force')) {
    throw new Error('settings/weddingProfile ja existe. Use --force somente para substitui-lo conscientemente.')
  }

  await reference.set({
    ...weddingProfile,
    createdAt: snapshot.exists && snapshot.get('createdAt')
      ? snapshot.get('createdAt')
      : FieldValue.serverTimestamp(),
  }, { merge: false })

  console.log(`Perfil do casamento criado em ${projectId}/settings/weddingProfile.`)
}

seed().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
