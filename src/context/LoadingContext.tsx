/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useContext, useState, useCallback } from 'react';
import GlobalLoadingSpinner from '../components/common/GlobalLoadingSpinner';

interface LoadingState {
  isLoading: boolean;
  message?: string;
  subMessage?: string;
}

interface LoadingContextType {
  isLoading: boolean;
  message?: string;
  subMessage?: string;
  showLoading: (message?: string, subMessage?: string) => void;
  hideLoading: () => void;
  withLoading: <T>(asyncFn: () => Promise<T>, message?: string, subMessage?: string) => Promise<T>;
}

const LoadingContext = createContext<LoadingContextType | undefined>(undefined);

export function LoadingProvider({ children }: { children: React.ReactNode }) {
  const [loadingState, setLoadingState] = useState<LoadingState>({
    isLoading: false,
    message: 'Loading...',
    subMessage: undefined,
  });

  const showLoading = useCallback((message = 'Loading...', subMessage?: string) => {
    setLoadingState({
      isLoading: true,
      message,
      subMessage,
    });
  }, []);

  const hideLoading = useCallback(() => {
    setLoadingState(prev => ({
      ...prev,
      isLoading: false,
    }));
  }, []);

  const withLoading = useCallback(async <T,>(
    asyncFn: () => Promise<T>, 
    message = 'Processing...', 
    subMessage?: string
  ): Promise<T> => {
    showLoading(message, subMessage);
    try {
      const result = await asyncFn();
      return result;
    } finally {
      hideLoading();
    }
  }, [showLoading, hideLoading]);

  return (
    <LoadingContext.Provider
      value={{
        isLoading: loadingState.isLoading,
        message: loadingState.message,
        subMessage: loadingState.subMessage,
        showLoading,
        hideLoading,
        withLoading,
      }}
    >
      {children}
      {loadingState.isLoading && (
        <GlobalLoadingSpinner
          message={loadingState.message}
          subMessage={loadingState.subMessage}
          fullscreen={true}
        />
      )}
    </LoadingContext.Provider>
  );
}

export function useLoading(): LoadingContextType {
  const context = useContext(LoadingContext);
  if (!context) {
    throw new Error('useLoading must be used within a LoadingProvider');
  }
  return context;
}
