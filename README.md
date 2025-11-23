# Image Generation MCP Server

Servidor MCP (Model Context Protocol) para geração e edição de imagens utilizando múltiplos provedores (Gemini, Replicate, Hugging Face).

## Instalação

```bash
npm install
```

## Configuração

Você pode configurar o provedor através de variáveis de ambiente. O servidor selecionará automaticamente o provedor com base na configuração ou disponibilidade das chaves.

### Provedores Suportados

#### 1. Google Gemini (Padrão)
- **Modelo**: `gemini-3-pro-image-preview`
- **Variável**: `GEMINI_API_KEY`
- **Custo**: Gratuito (atualmente em preview)

#### 2. Replicate
- **Geração**: `sdxl-lightning` (Rápido e baixo custo)
- **Edição**: `instruct-pix2pix`
- **Variável**: `REPLICATE_API_TOKEN`
- **Configuração Explícita**: `IMAGE_GENERATION_PROVIDER=replicate`

#### 3. Hugging Face
- **Geração**: `stable-diffusion-xl-base-1.0`
- **Edição**: *Não suportado na versão atual*
- **Variável**: `HUGGING_FACE_TOKEN`
- **Configuração Explícita**: `IMAGE_GENERATION_PROVIDER=huggingface`

### Exemplo de `.env`

```bash
# Gemini
GEMINI_API_KEY=sua-chave-api-gemini

# Replicate
REPLICATE_API_TOKEN=sua-chave-api-replicate

# Hugging Face
HUGGING_FACE_TOKEN=sua-chave-api-huggingface

# Escolha forçada do provedor (opcional)
IMAGE_GENERATION_PROVIDER=replicate
```

## Configuração em Clientes MCP

### Claude Desktop / Amp / Outros

Configure como servidor MCP "command" ou "stdio".

**Comando**:
```bash
node path/to/mcp-server.js
```

**Environment Variables**:
Certifique-se de passar as variáveis de ambiente necessárias (`GEMINI_API_KEY`, etc.) na configuração do seu cliente.

## Ferramentas Disponíveis

### `generate_image_from_text`
Gera uma nova imagem a partir de uma descrição textual.

**Parâmetros:**
- `prompt`: Descrição detalhada da imagem.
- `output_path` (opcional): Caminho para salvar o arquivo.

### `edit_image`
Edita uma imagem existente com base em instruções.

**Parâmetros:**
- `image_path`: Caminho para a imagem original.
- `prompt`: Instruções de edição.
- `output_path` (opcional): Caminho para salvar o resultado.

## Requisitos

- Node.js 18+
- Chave de API de pelo menos um dos provedores suportados.
