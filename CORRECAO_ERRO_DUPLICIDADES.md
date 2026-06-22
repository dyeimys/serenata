# Correção: Erro ao Atualizar Análise de Duplicidades

## Problema Identificado

**Erro:** `FirebaseError: internal`

Quando o usuário tentava atualizar a análise de duplicidades (botão "Atualizar análise"), a Cloud Function falhava com um erro vago "internal" do Firebase.

### Causa Raiz

O erro ocorria porque:

1. **Serialização de valores `undefined` no Firestore**: A função `buildDuplicateGroups` criava objetos com propriedade `attending: undefined` quando o valor era inválido. O Firestore não consegue serializar valores `undefined`, causando o erro interno.

2. **Falta de validação de dados**: Os dados sendo salvos não eram sanitizados antes de serem persistidos no banco de dados.

3. **Falta de tratamento de erros**: Erros não capturados causavam mensagens genéricas que não ajudavam a diagnosticar o problema.

## Soluções Implementadas

### 1. Sanitização de Dados em `writeRsvpConsolidationSnapshot` (functions/index.js)

Adicionado código para remover valores `undefined` antes de salvar:

```javascript
const sanitizedGroups = groups.map((group) => ({
  // ... dados do grupo ...
  entries: group.entries.map((entry) => {
    const sanitized = {
      id: entry.id,
      name: entry.name,
      phone: entry.phone,
      adults: entry.adults,
      children: entry.children,
      totalGuests: entry.totalGuests,
    }
    // Apenas adicionar attending se for um booleano válido
    if (typeof entry.attending === 'boolean') {
      sanitized.attending = entry.attending
    }
    return sanitized
  }),
}))
```

### 2. Try-Catch Melhorado

Adicionados blocos try-catch em:
- `writeRsvpConsolidationSnapshot`: Captura erros ao escrever no Firestore
- `scanRsvpDuplicatesNow`: Captura erros gerais da função
- `consolidateRsvpDuplicates`: Captura erros em cada etapa do processo
- `getRequester`: Captura erros ao verificar permissões

### 3. Mensagens de Erro Mais Informativas

Mensagens de erro agora incluem contexto sobre o que falhou:
- "Erro ao atualizar análise de duplicidades. Verifique se há dados válidos nas submissões."
- "Erro ao criar registro consolidado. Tente novamente."
- "Erro ao verificar permissões. Tente novamente."

### 4. Frontend: Melhor Exibição de Erros (Guests.tsx)

Adicionada lógica para extrair mensagem de erro do objeto `caught` e exibir ao usuário:

```typescript
const errorMessage = caught instanceof Error 
  ? caught.message 
  : 'Não foi possível atualizar a análise agora. Verifique seu papel e tente novamente.'
setScanMessage(errorMessage)
```

## Arquivos Modificados

1. **functions/index.js**
   - `writeRsvpConsolidationSnapshot`: Sanitiza dados
   - `scanRsvpDuplicatesNow`: Try-catch melhorado
   - `consolidateRsvpDuplicates`: Try-catch em múltiplas etapas
   - `getRequester`: Try-catch para verificação de permissões

2. **src/pages/Guests.tsx**
   - `refreshDuplicateScan`: Melhor tratamento de erros

## Testes Recomendados

1. Criar uma submissão RSVP com valores nulos/vazios
2. Tentar atualizar a análise de duplicidades
3. Verificar se não há mais erro "internal"
4. Verificar as mensagens de erro no console (Firebase Cloud Functions logs)

## Próximas Melhorias

- Adicionar validação de dados (schema) nas submissões RSVP
- Implementar retry automático para falhas transientes
- Adicionar monitoring/alertas para erros em Cloud Functions
- Criar testes unitários para `buildDuplicateGroups`

