# Serenata

Base web para um sistema de gestão de casamentos, construída com React, TypeScript, Vite e Firebase Authentication.

## Primeiros passos

Requisitos: Node.js 20.19+ ou 22.12+.

```bash
npm install
copy .env.example .env
npm run dev
```

## Configurar o Firebase

1. Crie ou abra um projeto no [Firebase Console](https://console.firebase.google.com/).
2. Em **Configurações do projeto > Seus aplicativos**, adicione um aplicativo Web.
3. Copie os valores de `firebaseConfig` para as variáveis correspondentes no arquivo `.env`.
4. Em **Authentication > Sign-in method**, habilite **E-mail/senha**.
5. Em **Authentication > Users**, crie o primeiro usuário que poderá acessar o sistema.

O arquivo `.env` não é versionado. As chaves públicas de configuração identificam o app; a segurança dos dados deve ser garantida pelas regras do Firebase e pela validação de tokens no futuro backend.

## Comandos

- `npm run dev`: inicia o ambiente local.
- `npm run build`: valida o TypeScript e gera a versão de produção.
- `npm run lint`: executa a análise estática.
- `npm run preview`: visualiza o build de produção.
- `npm start`: serve o build na porta definida por `PORT` (padrão `8080`).

## Deploy no Firebase

Este projeto pode ser publicado de duas formas:

- **Firebase App Hosting:** execute o deploy novamente. O script `start` inicia o servidor na porta exigida pelo Cloud Run.
- **Firebase Hosting clássico (recomendado para este frontend estático):** execute `npm run build` e depois `firebase deploy --only hosting`.

O arquivo `firebase.json` já aponta para `dist` e inclui o fallback de rotas da SPA.

### SEO e compartilhamento

Os metadados Open Graph, Twitter Card, JSON-LD, sitemap e imagem social usam `https://heldereanapaula-cee2f.web.app/` como URL pública. Ao conectar um domínio personalizado, atualize esse endereço em `index.html`, `public/robots.txt` e `public/sitemap.xml`.

## Estrutura atual

- Login com e-mail e senha via Firebase.
- Recuperação de senha por e-mail.
- Persistência e observação da sessão do usuário.
- Cadastro obrigatório do perfil no primeiro acesso.
- Área autenticada com header, menu lateral e dashboard inicial.
- Lista de confirmações em tempo real a partir de `rsvpSubmissions`.
- Layout responsivo para desktop e celular.
- Assistente de IA para organizacao do casamento, com conversas privadas por usuario.

## Assistente de IA

O assistente usa Genkit nas Cloud Functions em `us-central1`, compativel com o Firestore `nam5`, e Gemini pelo Google Cloud Vertex AI. O navegador nunca recebe credenciais do modelo. A API `aiplatform.googleapis.com` precisa estar habilitada no projeto.

Configuracoes opcionais das Functions:

- `GENKIT_MODEL`: modelo usado pelo assistente; padrao `gemini-2.5-flash`.
- `GENKIT_LOCATION`: localizacao do modelo; padrao `global`.
- `ENFORCE_APP_CHECK`: use `true` depois de configurar App Check no aplicativo Web.

As conversas ficam em `chatThreads`, com mensagens e propostas em subcolecoes. Cada thread registra `createdByUserId` e todos os acessos passam pelas callable functions. O cliente nao acessa essas colecoes diretamente.

O perfil global do casamento fica em `settings/weddingProfile`. Para inicializa-lo em um projeto novo usando Application Default Credentials:

```bash
cd functions
npm run seed:wedding-profile
```

O botao flutuante abre o chat como painel lateral no desktop e em tela cheia em dispositivos com ate 850 px. Propostas da IA so criam tarefas depois da confirmacao explicita do usuario.

## Rotas da aplicação

- `/login`: autenticação.
- `/dashboard`: visão geral.
- `/convidados`: confirmações de presença.
- `/presentes`: catálogo administrativo de presentes.
- `/tarefas`: quadro Kanban.
- `/configuracoes`: configurações do sistema.
- `/agenda`: temporariamente desativada e redirecionada para o dashboard.

Todas as rotas administrativas exigem autenticação. O destino solicitado é preservado durante o redirecionamento para o login.

## Acesso ao Firestore

A conta autenticada precisa ter permissão de leitura na coleção. Nas regras do Firestore, mantenha a criação compatível com o site do convite e restrinja a consulta ao painel autenticado. Exemplo da regra de leitura:

```text
match /rsvpSubmissions/{submissionId} {
  allow read: if request.auth != null;
}
```

### Perfis de usuário

Cada usuário autenticado possui um documento em `users/{uid}`. O ID do documento é o mesmo UID do Firebase Authentication.

```ts
{
  name: string
  role: string
  phone: string
  createdAt: Timestamp
  updatedAt: Timestamp
}
```

Use regras que permitam a cada conta acessar apenas o próprio perfil:

```text
match /users/{userId} {
  allow read, create, update: if request.auth != null && request.auth.uid == userId;
}
```

### Gestão de usuários

A aba **Configurações > Gestão de usuários** consulta o Firebase Authentication pelas Cloud Functions `listAuthenticationUsers` e `updateAuthenticationUserRole`. Usuários autenticados podem consultar as contas; apenas perfis com papel `Noivo`, `Noiva`, `Assessor` ou `Assessor(a)` podem alterar o papel de outros usuários. A autorização é validada novamente no servidor.

Para publicar os endpoints administrativos:

```bash
firebase deploy --only functions
```

O projeto Firebase precisa estar no plano Blaze para publicar Cloud Functions.

### Lista de presentes

Os presentes são armazenados na coleção `giftRegistryItems` com este formato:

```ts
{
  title: string
  giftType: string
  image: string
  imageAlt: string // usa title quando não informado
  productLink: string // vazio quando não informado
  received: boolean
  disabled: boolean
  createdAt: Timestamp
  updatedAt: Timestamp
}
```

O painel precisa de leitura e escrita autenticadas:

```text
match /giftRegistryItems/{giftId} {
  allow read, write: if request.auth != null;
}
```

Para o futuro catálogo público, consulte apenas documentos com `disabled == false` e ajuste a regra de leitura pública de acordo com esse filtro.

### Configuração da lista de presentes

A aba **Configurações > Lista de presentes** salva um documento único em `settings/gifts`:

```ts
{
  enableGiftConfirmation: boolean
  whatsappNumber: string
  confirmationMessageTemplate: string // deve conter {item}
  updatedAt: Timestamp
}
```

Como o site público precisará ler essa configuração, a leitura pode ser pública enquanto a escrita permanece administrativa:

```text
match /settings/gifts {
  allow read: if true;
  allow write: if request.auth != null;
}
```

### Quadro de tarefas

O módulo Kanban usa a coleção `tasks`:

```ts
{
  title: string
  description: string
  status: 'todo' | 'in_progress' | 'done'
  priority: 'low' | 'medium' | 'high'
  dueDate: string // YYYY-MM-DD ou vazio
  order: number
  createdAt: Timestamp
  updatedAt: Timestamp
}
```

As tarefas são administrativas e devem exigir autenticação:

```text
match /tasks/{taskId} {
  allow read, write: if request.auth != null;
}
```

### Agenda

Compromissos avulsos são armazenados em `agendaEvents`. Tarefas com `dueDate` aparecem automaticamente no calendário e não são duplicadas nesta coleção.

```ts
{
  title: string
  description: string
  date: string // YYYY-MM-DD
  startTime: string // HH:mm ou vazio
  endTime: string // HH:mm ou vazio
  location: string
  category: string
  createdAt: Timestamp
  updatedAt: Timestamp
}
```

```text
match /agendaEvents/{eventId} {
  allow read, write: if request.auth != null;
}
```

Ao transformar um compromisso avulso em tarefa, o painel cria o documento em `tasks` e remove o documento original de `agendaEvents` no mesmo lote.
