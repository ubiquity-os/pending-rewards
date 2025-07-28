# Nonce Checker

A standalone tool to check if nonces are claimed on the Permit2 contract for permits stored in the Supabase database.

## Features

- ✅ Checks nonce status against Permit2 contract on multiple networks (Ethereum mainnet, Gnosis Chain)
- ✅ Fetches permit data from Supabase with proper joins
- ✅ Batch processing (20 permits per batch) for efficient execution  
- ✅ Retry logic for failed requests
- ✅ Exports results to CSV format
- ✅ Token symbol lookup for better reporting
- ✅ Proper BigNumber handling for large nonce values

## Setup

1. Install dependencies:
```bash
bun install
```

2. Copy environment variables:
```bash
cp ../.env .env
```

3. Make sure your `.env` file contains:
```
SUPABASE_URL=your_supabase_url
SUPABASE_KEY=your_supabase_key
RPC_URL_MAINNET=your_ethereum_rpc_url
RPC_URL_GNOSIS=your_gnosis_rpc_url
```

## Usage

Run the nonce checker:
```bash
bun src/index.ts
```

Or use the npm script:
```bash
bun start
```

## Output

The script will:
1. Query up to 1000 permits from Supabase
2. Process them in batches of 20
3. Check each nonce against the Permit2 contract
4. Export results to `nonce-results.csv`

### CSV Format

The output CSV contains the following columns:
- `nonce`: The permit nonce value
- `amount`: Token amount in wei
- `partner_address`: Address of the permit partner
- `token_address`: ERC20 token contract address
- `network`: Network ID (1 for Ethereum, 100 for Gnosis)
- `user_address`: Beneficiary wallet address
- `is_claimed`: Boolean indicating if nonce is claimed
- `token_symbol`: Token symbol (e.g., WXDAI, UUSD)

## Example Output

```
nonce,amount,partner_address,token_address,network,user_address,is_claimed,token_symbol
42883...0621,1330000000000000000,0x9051...7680,0xC6ed...2068,100,0x0BEd...7025,false,UUSD
10317...6401,25000000000000000000,0x054E...7c3C,0xe91D...63a97d,100,0x1133...99B1,true,WXDAI
```

## Performance

- Processes ~1000 permits in under 5 minutes
- Uses efficient batch processing to avoid rate limits
- Implements retry logic for failed blockchain calls
- Caches contract instances and providers for better performance

## Error Handling

The script handles various error scenarios:
- Missing required data (skips invalid permits)
- Blockchain RPC failures (retries failed requests)
- Token symbol lookup failures (falls back to "UNKNOWN")
- Network connectivity issues (graceful error logging)
