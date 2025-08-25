'use client';

import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  data?: any; // For structured results
}

interface SearchResult {
  type: 'leads' | 'conversations' | 'insights' | 'query';
  data: any;
}

export default function SearchPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Sample queries for user guidance
  const sampleQueries = [
    "Show me all leads in Finance with budget >$500k that haven't been contacted in 2 weeks",
    "What patterns do our successful deals have in common?",
    "Find conversations where pricing was discussed",
    "Which leads are most likely to convert based on current pipeline?",
    "Show pipeline health metrics and bottlenecks",
    "Find leads similar to our top 3 closed deals"
  ];

  const handleSendMessage = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      // Send to search agent endpoint
      const response = await axios.post('/api/agent/search', {
        query: input,
        conversationId
      });

      const { results, message, newConversationId } = response.data;
      
      if (newConversationId) {
        setConversationId(newConversationId);
      }

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: message || formatResults(results),
        timestamp: new Date(),
        data: results
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      console.error('Search error:', error);
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: 'I encountered an error while searching. Please try rephrasing your query.',
        timestamp: new Date()
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const formatResults = (results: any): string => {
    if (!results) return 'No results found.';
    
    let formatted = '';
    
    if (results.leads && results.leads.length > 0) {
      formatted += `Found ${results.leads.length} leads:\\n`;
      results.leads.forEach((lead: any) => {
        formatted += `• ${lead.companyName} - ${lead.contactName} (Score: ${lead.score}/100)\\n`;
      });
    }
    
    if (results.conversations && results.conversations.length > 0) {
      formatted += `\\nFound ${results.conversations.length} conversations:\\n`;
      results.conversations.forEach((conv: any) => {
        formatted += `• ${conv.leadName || 'Unknown'} - ${conv.summary}\\n`;
      });
    }
    
    if (results.insights) {
      formatted += `\\nInsights:\\n${results.insights}`;
    }
    
    return formatted || 'No specific results found. Try refining your search.';
  };

  const renderMessage = (message: Message) => {
    if (message.role === 'user') {
      return (
        <div className="flex justify-end mb-4">
          <div className="bg-blue-600 text-white rounded-lg px-4 py-2 max-w-2xl">
            {message.content}
          </div>
        </div>
      );
    }

    // Assistant message with potential structured data
    return (
      <div className="flex justify-start mb-4">
        <div className="bg-gray-100 rounded-lg px-4 py-2 max-w-3xl">
          <pre className="whitespace-pre-wrap font-sans">{message.content}</pre>
          
          {/* Render structured data if available */}
          {message.data?.leads && message.data.leads.length > 0 && (
            <div className="mt-4 bg-white rounded-lg p-3">
              <h4 className="font-semibold text-sm mb-2">📊 Lead Results:</h4>
              <div className="space-y-2">
                {message.data.leads.map((lead: any) => (
                  <div key={lead.id} className="border-l-4 border-blue-500 pl-3 py-1">
                    <div className="font-medium">{lead.companyName}</div>
                    <div className="text-sm text-gray-600">
                      {lead.contactName} • Score: {lead.score}/100 • Stage: {lead.stage}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {message.data?.queryResult && (
            <div className="mt-4 bg-white rounded-lg p-3">
              <h4 className="font-semibold text-sm mb-2">📈 Query Results:</h4>
              <div className="overflow-x-auto">
                <pre className="text-xs">{JSON.stringify(message.data.queryResult, null, 2)}</pre>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-screen max-h-screen">
      {/* Header */}
      <div className="bg-white border-b px-6 py-4">
        <h1 className="text-2xl font-bold text-gray-900">🔍 Intelligent Search</h1>
        <p className="text-sm text-gray-600 mt-1">
          Ask questions about your leads, conversations, and pipeline in natural language
        </p>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-6 bg-gray-50">
        {messages.length === 0 ? (
          <div className="max-w-3xl mx-auto">
            <div className="bg-white rounded-lg shadow-sm p-6">
              <h3 className="font-semibold text-gray-900 mb-4">Try asking:</h3>
              <div className="space-y-2">
                {sampleQueries.map((query, idx) => (
                  <button
                    key={idx}
                    onClick={() => setInput(query)}
                    className="block w-full text-left px-4 py-2 bg-gray-50 hover:bg-gray-100 rounded-lg text-sm text-gray-700 transition"
                  >
                    💡 {query}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="max-w-4xl mx-auto">
            {messages.map(message => (
              <div key={message.id}>
                {renderMessage(message)}
              </div>
            ))}
            {isLoading && (
              <div className="flex justify-start mb-4">
                <div className="bg-gray-100 rounded-lg px-4 py-2">
                  <div className="flex items-center space-x-2">
                    <div className="animate-pulse">🤔</div>
                    <span>Searching...</span>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input Area */}
      <div className="border-t bg-white p-4">
        <div className="max-w-4xl mx-auto">
          <div className="flex space-x-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
              placeholder="Ask about leads, conversations, or pipeline metrics..."
              className="flex-1 px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={isLoading}
            />
            <button
              onClick={handleSendMessage}
              disabled={!input.trim() || isLoading}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? '⏳' : '🔍'} Search
            </button>
          </div>
          <p className="text-xs text-gray-500 mt-2 text-center">
            Powered by Grok AI • Natural language understanding for complex queries
          </p>
        </div>
      </div>
    </div>
  );
}