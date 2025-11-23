# Image Generation MCP Server

Servidor MCP (Model Context Protocol) para geração de imagens coloridas e aprimoradas usando a API Gemini.

## Instalação

```bash
npm install
```

## Configuração

Defina a variável de ambiente `GEMINI_API_KEY`:

```bash
export GEMINI_API_KEY=sua-chave-api-gemini
```

## Uso Direto (Teste)

```bash
node server.js caminho/para/imagem.png
```

Isso gerará um arquivo `output.png` com a imagem aprimorada.

## Configuração em Clientes MCP

### Claude Desktop (macOS/Linux)

Adicione ao arquivo `~/.config/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "image-generation": {
      "command": "node",
      "args": ["/caminho/para/mcp-server.js"],
      "env": {
        "GEMINI_API_KEY": "sua-chave-api-gemini"
      }
    }
  }
}
```

### Claude Desktop (Windows)

Adicione ao arquivo `%APPDATA%\Claude\claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "image-generation": {
      "command": "node",
      "args": ["D:\\caminho\\para\\mcp-server.js"],
      "env": {
        "GEMINI_API_KEY": "sua-chave-api-gemini"
      }
    }
  }
}
```

### Kilocode / Amp

Configure como servidor MCP customizado com os seguintes parâmetros:

- **Command**: `node`
- **Args**: `["/caminho/para/mcp-server.js"]`
- **Environment**: `GEMINI_API_KEY=sua-chave-api`

## Ferramentas Disponíveis

### `generate_colored_image`

Gera uma versão colorida e aprimorada de uma imagem (quadrinho, esboço, etc).

**Parâmetros:**
- `image_path` (obrigatório): Caminho para o arquivo de imagem (PNG, JPG, GIF, WebP)
- `output_path` (opcional): Caminho onde salvar a imagem gerada (padrão: `output.png`)

**Resposta:**
```json
{
  "success": true,
  "output_path": "/caminho/para/output.png",
  "message": "Image generated and saved successfully"
}
```

## Arquivos

- `server.js` - Servidor simples para teste direto
- `mcp-server.js` - Servidor MCP completo para integração com clientes
- `gemini.rs` - Implementação de referência em Rust
- `package.json` - Dependências do Node.js

## Requisitos

- Node.js 18+
- Chave de API Gemini válida
- Acesso à internet para chamar a API Gemini

## Notas

- O modelo usado é `gemini-3-pro-image-preview` que suporta geração de imagens
- Imagens são processadas em Base64
- Suporta os seguintes formatos: PNG, JPG, JPEG, GIF, WebP
- Timeout configurado para 60 segundos
