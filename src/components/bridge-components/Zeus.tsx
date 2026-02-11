"use client";

import { useState } from "react";
import { useWallet } from '@/hooks/useAppKitWallet';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Info, ArrowDown, Loader2, CheckCircle, AlertCircle } from "lucide-react";

// Zeus bridge configuration interface
interface ZeusBridgeConfig {
  network: 'Mainnet' | 'Testnet';
  theme?: {
    mode?: 'dark' | 'light';
    primary?: string;
    background?: string;
  };
}

// Status types for transactions
type TransactionStatus = 'idle' | 'pending' | 'completed' | 'failed';

const Zeus = () => {
  const { connected } = useWallet();
  
  // States
  const [amount, setAmount] = useState<string>('');
  const [btcAddress, setBtcAddress] = useState<string>('');
  const [direction, setDirection] = useState<'toSolana' | 'toBtc'>('toSolana');
  const [status, setStatus] = useState<TransactionStatus>('idle');
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [isValidBtcAddress, setIsValidBtcAddress] = useState<boolean>(true);

  // Configuration for Zeus bridge
  const config: ZeusBridgeConfig = {
    network: 'Testnet',
    theme: {
      mode: 'dark',
      primary: '#FF4040',
      background: '#161616'
    }
  };

  // Validate Bitcoin address with basic regex
  const validateBtcAddress = (address: string): boolean => {
    // Basic BTC address validation - in production, use a more robust validator
    const btcAddressRegex = /^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62}$/;
    return btcAddressRegex.test(address);
  };

  // Handle amount change
  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Only allow numbers and decimal points
    const value = e.target.value;
    if (/^[0-9]*\.?[0-9]*$/.test(value) || value === '') {
      setAmount(value);
    }
  };

  // Handle BTC address change
  const handleBtcAddressChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const address = e.target.value;
    setBtcAddress(address);
    setIsValidBtcAddress(address === '' || validateBtcAddress(address));
  };

  // Toggle bridge direction
  const toggleDirection = () => {
    setDirection(direction === 'toSolana' ? 'toBtc' : 'toSolana');
  };

  // Process the bridge transaction
  const handleBridge = async () => {
    if (!connected) {
      setStatusMessage('Please connect your wallet first');
      return;
    }

    if (!amount || parseFloat(amount) <= 0) {
      setStatusMessage('Please enter a valid amount');
      return;
    }

    if (direction === 'toBtc' && (!btcAddress || !isValidBtcAddress)) {
      setStatusMessage('Please enter a valid Bitcoin address');
      return;
    }

    try {
      setStatus('pending');
      setStatusMessage(`Initiating ${direction === 'toSolana' ? 'BTC to Solana' : 'Solana to BTC'} bridge...`);

      // Simulating API call delay
      await new Promise(resolve => setTimeout(resolve, 2000));

      // In a real implementation, you would call the Zeus bridge API here
      // For now, we'll simulate a successful transaction
      
      setStatus('completed');
      setStatusMessage(`Successfully initiated ${direction === 'toSolana' ? 'BTC to Solana' : 'Solana to BTC'} bridge transaction!`);
      
      // Reset form after successful transaction
      setTimeout(() => {
        setAmount('');
        setBtcAddress('');
        setStatus('idle');
        setStatusMessage('');
      }, 5000);
    } catch (error) {
      console.error('Bridge error:', error);
      setStatus('failed');
      setStatusMessage(`Failed to process transaction: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  // Render component
  return (
    <Card className="border-border bg-[#161616] max-w-md mx-auto">
      <CardHeader>
        <CardTitle className="text-xl">Zeus Bridge</CardTitle>
        <p className="text-sm text-sub-text">
          Bridge BTC to/from Solana using ZeusLayer protocol
        </p>
      </CardHeader>
      
      <CardContent className="space-y-5">
        {/* Direction selector */}
        <div className="flex justify-between items-center bg-[#0F0F0F] p-3 rounded-lg">
          <div 
            className={`px-4 py-2 rounded-lg cursor-pointer ${direction === 'toSolana' ? 'bg-primary text-white' : 'bg-secondary/30 text-sub-text'}`}
            onClick={() => setDirection('toSolana')}
          >
            BTC to Solana
          </div>
          <div 
            className={`px-4 py-2 rounded-lg cursor-pointer ${direction === 'toBtc' ? 'bg-primary text-white' : 'bg-secondary/30 text-sub-text'}`}
            onClick={() => setDirection('toBtc')}
          >
            Solana to BTC
          </div>
        </div>
        
        {/* From asset */}
        <div className="space-y-2">
          <p className="text-sm text-sub-text">From</p>
          <div className="bg-[#0F0F0F] p-3 rounded-lg">
            <div className="flex justify-between items-center">
              <span className="text-white">
                {direction === 'toSolana' ? 'BTC' : 'SOL'}
              </span>
              <input
                type="text"
                value={amount}
                onChange={handleAmountChange}
                placeholder="0.0"
                className="bg-transparent border-none text-right text-white w-2/3 focus:outline-none"
              />
            </div>
          </div>
        </div>
        
        {/* Direction arrow */}
        <div className="flex justify-center">
          <Button
            variant="ghost"
            size="sm"
            className="rounded-full h-8 w-8 p-0"
            onClick={toggleDirection}
          >
            <ArrowDown className="h-4 w-4" />
          </Button>
        </div>
        
        {/* To asset */}
        <div className="space-y-2">
          <p className="text-sm text-sub-text">To</p>
          <div className="bg-[#0F0F0F] p-3 rounded-lg">
            <div className="flex justify-between items-center">
              <span className="text-white">
                {direction === 'toSolana' ? 'zBTC' : 'BTC'}
              </span>
              <span className="text-white">
                {amount ? amount : '0.0'}
              </span>
            </div>
          </div>
        </div>
        
        {/* Bitcoin address input for Solana to BTC direction */}
        {direction === 'toBtc' && (
          <div className="space-y-2">
            <p className="text-sm text-sub-text">BTC Recipient Address</p>
            <input
              type="text"
              value={btcAddress}
              onChange={handleBtcAddressChange}
              placeholder="Enter BTC address"
              className={`w-full bg-[#0F0F0F] p-3 rounded-lg text-white border ${!isValidBtcAddress ? 'border-red-500' : 'border-border'}`}
            />
            {!isValidBtcAddress && btcAddress && (
              <p className="text-xs text-red-500">Invalid Bitcoin address format</p>
            )}
          </div>
        )}
        
        {/* Info box */}
        <div className="flex items-start gap-2 bg-[#0F0F0F] p-3 rounded-lg">
          <Info className="h-4 w-4 flex-shrink-0 mt-0.5 text-sub-text" />
          <div className="text-xs text-sub-text">
            <p className="mb-1">
              {direction === 'toSolana' 
                ? "Bridge your Bitcoin to Solana to use in DeFi applications."
                : "Bridge your zBTC back to native Bitcoin."
              }
            </p>
            <p>Network fee: {direction === 'toSolana' ? '0.0001 BTC' : '0.001 SOL'}</p>
          </div>
        </div>
        
        {/* Status message */}
        {status !== 'idle' && statusMessage && (
          <div className={`flex items-center gap-2 p-3 rounded-lg ${
            status === 'pending' ? 'bg-yellow-500/20 text-yellow-200' :
            status === 'completed' ? 'bg-green-500/20 text-green-200' :
            'bg-red-500/20 text-red-200'
          }`}>
            {status === 'pending' && <Loader2 className="h-4 w-4 animate-spin" />}
            {status === 'completed' && <CheckCircle className="h-4 w-4" />}
            {status === 'failed' && <AlertCircle className="h-4 w-4" />}
            <span className="text-sm">{statusMessage}</span>
          </div>
        )}
        
        {/* Bridge button */}
        <Button
          onClick={handleBridge}
          disabled={!amount || parseFloat(amount) <= 0 || status === 'pending' || (direction === 'toBtc' && (!btcAddress || !isValidBtcAddress))}
          className="w-full bg-primary hover:bg-primary/80"
        >
          {status === 'pending' ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Processing...
            </>
          ) : (
            connected ? `Bridge ${direction === 'toSolana' ? 'BTC to Solana' : 'Solana to BTC'}` : 'Connect Wallet'
          )}
        </Button>
        
        {/* Network information */}
        <div className="text-center text-xs text-sub-text">
          Running on {config.network} · Zeus Protocol
        </div>
      </CardContent>
    </Card>
  );
};

export default Zeus;