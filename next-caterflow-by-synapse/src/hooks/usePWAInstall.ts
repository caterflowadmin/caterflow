// src/hooks/usePWAInstall.ts
'use client';
import { logger } from '@/lib/logger';

import { useState, useEffect } from 'react';

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  prompt(): Promise<void>;
}

export function usePWAInstall() {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstallable, setIsInstallable] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    // Check if the app is already installed
    const isAppInstalled = () => {
      // Different ways to check if PWA is installed
      if (window.matchMedia('(display-mode: standalone)').matches) {
        return true;
      }
      if ('standalone' in window.navigator) {
        return (window.navigator as any).standalone === true;
      }
      return false;
    };

    setIsInstalled(isAppInstalled());

    const handleBeforeInstallPrompt = (e: BeforeInstallPromptEvent) => {
      // Prevent the default mini-infobar from appearing
      e.preventDefault();
      // Store the event for later use
      setInstallPrompt(e);
      setIsInstallable(true);
    };

    const handleAppInstalled = () => {
      setIsInstallable(false);
      setIsInstalled(true);
      setInstallPrompt(null);
    };

    // Listen for the beforeinstallprompt event
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt as any);

    // Listen for when the app is installed
    window.addEventListener('appinstalled', handleAppInstalled);

    // Check on page load
    if (isAppInstalled()) {
      setIsInstallable(false);
      setIsInstalled(true);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt as any);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const promptInstall = async () => {
    if (!installPrompt) {
      logger.debug('No install prompt available');
      return false;
    }

    try {
      // Show the install prompt
      await installPrompt.prompt();

      // Wait for the user to respond to the prompt
      const choiceResult = await installPrompt.userChoice;

      if (choiceResult.outcome === 'accepted') {
        logger.debug('User accepted the install prompt');
        setIsInstallable(false);
        setIsInstalled(true);
        return true;
      } else {
        logger.debug('User dismissed the install prompt');
        // Keep the prompt available for later
        return false;
      }
    } catch (error) {
      console.error('Error prompting installation:', error);
      return false;
    }
  };

  return {
    installPrompt,
    isInstallable,
    isInstalled,
    promptInstall,
  };
}