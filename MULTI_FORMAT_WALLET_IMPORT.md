# Multi-Format Wallet Import Feature

## Overview

The Telegram bot now supports importing wallets in **5 different formats**, making it compatible with exports from Phantom, Solflare, and other popular Solana wallets.

## Supported Formats

### 1️⃣ Base58 String (Phantom/Solflare) ✨ **Most Common**
This is the format used by Phantom and Solflare when you export your private key.

**Example:**
```
5KQwrPbwdL6PhXujxW37FSSQZ1JiwsST4cqQzDeyXtP79zkvFD3TKCDBRwDLBYqhBKvmTknDkMPPWiKLHmqd4UTP
```

**Characteristics:**
- Single line of Base58-encoded characters
- Length: 43-88 characters
- Contains letters (uppercase and lowercase) and numbers
- No special characters

---

### 2️⃣ JSON Array
The traditional Solana format used by many tools and libraries.

**Example:**
```json
[123,45,67,89,12,34,56,78,...,234,156,78,90]
```

**Characteristics:**
- Array of 64 numbers
- Each number is between 0-255
- Enclosed in square brackets `[...]`
- Comma-separated

---

### 3️⃣ Hex String
Hexadecimal representation of the private key.

**Example with 0x prefix:**
```
0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b
```

**Example without prefix:**
```
1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b
```

**Characteristics:**
- 128 hexadecimal characters (0-9, a-f)
- Optional `0x` prefix
- Represents 64 bytes

---

### 4️⃣ Comma-Separated Numbers
Similar to JSON array but without brackets.

**Example:**
```
123,45,67,89,12,34,56,78,90,11,22,33,44,55,66,77,88,99,...,234,156,78,90
```

**Characteristics:**
- 64 comma-separated numbers
- Each number is between 0-255
- No brackets
- Useful for copying from spreadsheets or CSV files

---

### 5️⃣ Mnemonic Seed Phrase (BIP39)
12 or 24-word recovery phrase used by most wallets.

**Example (12 words):**
```
witch collapse practice feed shame open despair creek road again ice least
```

**Example (24 words):**
```
abandon ability able about above absent absorb abstract absurd abuse access accident accuse achieve acid acoustic acquire across act action actor actress actual adapt
```

**Characteristics:**
- 12 or 24 words separated by spaces
- Uses BIP39 wordlist
- Derives Solana wallet using path: `m/44'/501'/0'/0'`
- Most user-friendly format

---

## How It Works

### Import Process Flow

```
User sends private key
        ↓
PrivateKeyParser.parse()
        ↓
Detects format automatically
        ↓
Converts to Uint8Array
        ↓
Validates secret key
        ↓
Creates Keypair
        ↓
Stores encrypted in database
```

### Format Detection

The parser tries formats in this order:
1. **Base58** - Checks if string matches Base58 pattern and decodes to 64 bytes
2. **JSON Array** - Checks if string starts with `[` and is valid JSON with 64 numbers
3. **Comma-Separated** - Checks if string has commas and parses to 64 valid numbers
4. **Hex** - Checks if string is 128 hex characters (with or without `0x` prefix)
5. **Mnemonic** - Checks if string is 12 or 24 valid BIP39 words

---

## Security Features

### Storage
- All private keys are converted to JSON array format for consistent storage
- Encrypted using AES-256-GCM encryption
- Unique initialization vector (IV) for each wallet
- Encryption key stored in environment variable (never in database)

### Import Process
1. Private key is sent to bot in private chat
2. Bot parses and validates format
3. Creates encrypted wallet in database
4. **Immediately deletes user's message** containing private key
5. Confirms successful import with detected format

### Export Process
1. User must confirm warning about security risks
2. Private key exported in Base58 format (Phantom-compatible)
3. Message includes "Delete this message" button
4. Console logs export event for security audit

---

## Usage in Telegram Bot

### Import Wallet Command

1. Click "Import Wallet" button or send `/import`
2. Bot shows all supported formats with examples
3. Send your private key in ANY supported format
4. Bot automatically detects format and imports
5. Your message is deleted for security
6. Confirmation shows detected format

**Example Interaction:**

```
Bot: 📥 Import Wallet

Send your private key in ANY of these formats:

1️⃣ Base58 (Phantom/Solflare):
`5Kd3N...` (43-88 characters)

2️⃣ JSON Array:
`[123,45,67,...,234]` (64 numbers, 0-255)

3️⃣ Hex String:
`0x1a2b3c...` or `1a2b3c...` (128 hex characters)

4️⃣ Comma-Separated:
`123,45,67,...,234` (64 numbers)

5️⃣ Seed Phrase (12 or 24 words):
`word1 word2 word3...`

⚠️ IMPORTANT:
• Make sure this chat is private!
• Delete the message after importing
• Only import your own wallet

---

You: [paste your private key in any format]

---

Bot: ✅ Wallet Imported Successfully!

📍 Address:
`7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU`

✨ Format detected: base58

💡 Your wallet is now ready to use!
```

---

## Implementation Details

### File Structure

```
hypebiscus-garden/
├── src/
│   ├── utils/
│   │   └── privateKeyParser.ts       # Multi-format parser
│   ├── services/
│   │   └── walletService.ts          # Updated import method
│   └── bot/
│       └── handlers/
│           └── wallet.ts              # Updated UI messages
```

### Dependencies

```json
{
  "bip39": "^3.1.0",           // BIP39 mnemonic support
  "ed25519-hd-key": "^1.3.0",  // HD key derivation
  "bs58": "^5.0.0"             // Base58 encoding/decoding
}
```

### Key Functions

**PrivateKeyParser.parse(input: string)**
- Detects format automatically
- Returns `{ secretKey: Uint8Array, format: string }`
- Throws error if format is invalid

**PrivateKeyParser.validateSecretKey(secretKey: Uint8Array)**
- Validates that secret key can create valid Keypair
- Returns boolean

**PrivateKeyParser.getFormatExamples()**
- Returns formatted string with all format examples
- Used in bot UI messages

---

## Testing

### Test Case 1: Base58 Import
```typescript
const base58 = "5KQwrPbwdL6PhXujxW37FSSQZ1JiwsST4cqQzDeyXtP79zkvFD3...";
const result = await walletService.importWallet(userId, base58);
// Expected: { publicKey: "7xKXt...", format: "base58" }
```

### Test Case 2: JSON Array Import
```typescript
const jsonArray = "[123,45,67,...,234]";
const result = await walletService.importWallet(userId, jsonArray);
// Expected: { publicKey: "7xKXt...", format: "json" }
```

### Test Case 3: Mnemonic Import
```typescript
const mnemonic = "witch collapse practice feed shame open despair creek road again ice least";
const result = await walletService.importWallet(userId, mnemonic);
// Expected: { publicKey: "7xKXt...", format: "mnemonic" }
```

### Test Case 4: Invalid Format
```typescript
const invalid = "not a valid private key";
const result = await walletService.importWallet(userId, invalid);
// Expected: null (with error logged)
```

---

## Error Handling

### Invalid Format Error
```
❌ Invalid private key format.

**Supported Formats:**

1️⃣ Base58 (Phantom/Solflare): `5Kd3N...`
2️⃣ JSON Array: `[123,45,67,...,234]`
3️⃣ Hex String: `0x1a2b3c...` or `1a2b3c...`
4️⃣ Comma-Separated: `123,45,67,...,234`
5️⃣ Seed Phrase: `word1 word2 word3...`
```

### Validation Errors
- **Invalid length**: Secret key must be exactly 64 bytes
- **Invalid mnemonic**: Must be valid BIP39 words
- **Invalid keypair**: Secret key must create valid Solana keypair
- **Already has wallet**: User can only import one wallet

---

## Security Considerations

### DO ✅
- Always import in private chat with bot
- Delete your message after successful import
- Save private key securely offline
- Use seed phrase backup for long-term storage

### DON'T ❌
- Never share private key with anyone
- Don't import in group chats
- Don't screenshot private keys
- Don't store private keys in cloud services
- Don't import same wallet on multiple accounts

---

## Comparison with Other Wallets

| Feature | Hypebiscus Bot | Phantom | Solflare |
|---------|---------------|---------|----------|
| Base58 Import | ✅ | ✅ | ✅ |
| JSON Array Import | ✅ | ❌ | ❌ |
| Mnemonic Import | ✅ | ✅ | ✅ |
| Hex Import | ✅ | ❌ | ❌ |
| Comma-separated | ✅ | ❌ | ❌ |
| Auto-format Detection | ✅ | ❌ | ❌ |

---

## Future Enhancements

### Potential Additions
1. **QR Code Import** - Scan QR code containing private key
2. **Hardware Wallet Support** - Import from Ledger/Trezor
3. **Multi-wallet Support** - Allow multiple wallets per user
4. **Wallet Aliases** - Name your wallets for easy identification
5. **Import History** - Track when wallets were imported
6. **Format Conversion** - Convert between formats for export

---

## Conclusion

The multi-format wallet import feature makes Hypebiscus bot **compatible with all major Solana wallets** and significantly improves user experience by automatically detecting and parsing different private key formats.

Users can now seamlessly import wallets from:
- 🦊 Phantom (Base58)
- 🔥 Solflare (Base58)
- 📱 Mobile wallets (Mnemonic)
- 🛠️ CLI tools (JSON array, Hex)
- 📊 Spreadsheets (Comma-separated)

**No more format confusion - just paste and go!** 🚀
