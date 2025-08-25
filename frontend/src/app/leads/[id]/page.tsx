'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import axios from 'axios';
import debounce from 'lodash/debounce';

interface Lead {
  id: string;
  companyName: string;
  contactName: string;
  email: string;
  phone?: string;
  website?: string;
  score: number;
  stage: string;
  notes?: string;
  source?: string;
  budget?: string;
  qualificationNotes?: string;
  companyData?: any;
  activities?: any[];
  messages?: any[];
  createdAt: string;
  updatedAt: string;
}

export default function LeadDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const leadId = params.id as string;
  
  const [lead, setLead] = useState<Lead | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editedLead, setEditedLead] = useState<Partial<Lead>>({});
  const [activeTab, setActiveTab] = useState<'details' | 'activities' | 'messages'>('details');

  // Fetch lead data
  useEffect(() => {
    fetchLead();
  }, [leadId]);

  const fetchLead = async () => {
    try {
      const response = await axios.get(`/api/leads/${leadId}`);
      setLead(response.data);
      setEditedLead(response.data);
    } catch (error) {
      console.error('Error fetching lead:', error);
    } finally {
      setLoading(false);
    }
  };

  // Debounced save function
  const debouncedSave = useCallback(
    debounce(async (updates: Partial<Lead>) => {
      setSaving(true);
      try {
        const response = await axios.patch(`/api/leads/${leadId}`, updates);
        setLead(response.data);
        console.log('Lead saved successfully');
      } catch (error) {
        console.error('Error saving lead:', error);
      } finally {
        setSaving(false);
      }
    }, 1000),
    [leadId]
  );

  // Handle field changes with autosave
  const handleFieldChange = (field: keyof Lead, value: any) => {
    const updates = { ...editedLead, [field]: value };
    setEditedLead(updates);
    
    // Only save the changed field
    debouncedSave({ [field]: value });
  };

  // Handle company data changes
  const handleCompanyDataChange = (field: string, value: any) => {
    const updatedCompanyData = {
      ...editedLead.companyData,
      [field]: value
    };
    const updates = { ...editedLead, companyData: updatedCompanyData };
    setEditedLead(updates);
    
    debouncedSave({ companyData: updatedCompanyData });
  };

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-green-600 bg-green-50';
    if (score >= 60) return 'text-yellow-600 bg-yellow-50';
    return 'text-red-600 bg-red-50';
  };

  const getStageColor = (stage: string) => {
    const colors: Record<string, string> = {
      'NEW': 'bg-blue-100 text-blue-800',
      'QUALIFIED': 'bg-green-100 text-green-800',
      'CONTACTED': 'bg-purple-100 text-purple-800',
      'PROPOSAL': 'bg-yellow-100 text-yellow-800',
      'NEGOTIATION': 'bg-orange-100 text-orange-800',
      'CLOSED_WON': 'bg-green-100 text-green-800',
      'CLOSED_LOST': 'bg-red-100 text-red-800'
    };
    return colors[stage] || 'bg-gray-100 text-gray-800';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-lg">Loading lead details...</div>
      </div>
    );
  }

  if (!lead) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-lg">Lead not found</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        <div className="flex justify-between items-start">
          <div>
            <div className="flex items-center space-x-4">
              <button
                onClick={() => router.push('/leads')}
                className="text-gray-500 hover:text-gray-700"
              >
                ← Back to Leads
              </button>
              {saving && (
                <span className="text-sm text-gray-500 italic">Saving...</span>
              )}
            </div>
            <h1 className="text-3xl font-bold text-gray-900 mt-2">
              {editedLead.companyName}
            </h1>
            <p className="text-lg text-gray-600">{editedLead.contactName}</p>
          </div>
          <div className="flex items-center space-x-4">
            <div className={`px-4 py-2 rounded-lg font-semibold ${getScoreColor(lead.score)}`}>
              Score: {Math.round(lead.score)}/100
            </div>
            <span className={`px-3 py-1 rounded-full text-sm font-semibold ${getStageColor(lead.stage)}`}>
              {lead.stage.replace(/_/g, ' ')}
            </span>
          </div>
        </div>

        {/* Tabs */}
        <div className="mt-6 border-b border-gray-200">
          <nav className="-mb-px flex space-x-8">
            <button
              onClick={() => setActiveTab('details')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'details'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Details
            </button>
            <button
              onClick={() => setActiveTab('activities')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'activities'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Activities ({lead.activities?.length || 0})
            </button>
            <button
              onClick={() => setActiveTab('messages')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'messages'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Messages ({lead.messages?.length || 0})
            </button>
          </nav>
        </div>
      </div>

      {/* Content */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        {activeTab === 'details' && (
          <div className="space-y-6">
            {/* Contact Information */}
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Contact Information</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Contact Name</label>
                  <input
                    type="text"
                    value={editedLead.contactName || ''}
                    onChange={(e) => handleFieldChange('contactName', e.target.value)}
                    className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Email</label>
                  <input
                    type="email"
                    value={editedLead.email || ''}
                    onChange={(e) => handleFieldChange('email', e.target.value)}
                    className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Phone</label>
                  <input
                    type="tel"
                    value={editedLead.phone || ''}
                    onChange={(e) => handleFieldChange('phone', e.target.value)}
                    className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Source</label>
                  <input
                    type="text"
                    value={editedLead.source || ''}
                    onChange={(e) => handleFieldChange('source', e.target.value)}
                    className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>

            {/* Company Information */}
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Company Information</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Company Name</label>
                  <input
                    type="text"
                    value={editedLead.companyName || ''}
                    onChange={(e) => handleFieldChange('companyName', e.target.value)}
                    className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Website</label>
                  <input
                    type="url"
                    value={editedLead.website || ''}
                    onChange={(e) => handleFieldChange('website', e.target.value)}
                    className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Industry</label>
                  <input
                    type="text"
                    value={editedLead.companyData?.industry || ''}
                    onChange={(e) => handleCompanyDataChange('industry', e.target.value)}
                    className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Company Size</label>
                  <input
                    type="text"
                    value={editedLead.companyData?.size || ''}
                    onChange={(e) => handleCompanyDataChange('size', e.target.value)}
                    className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>

            {/* Lead Status */}
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Lead Status</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Stage</label>
                  <select
                    value={editedLead.stage || 'NEW'}
                    onChange={(e) => handleFieldChange('stage', e.target.value)}
                    className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="NEW">New</option>
                    <option value="QUALIFIED">Qualified</option>
                    <option value="CONTACTED">Contacted</option>
                    <option value="PROPOSAL">Proposal</option>
                    <option value="NEGOTIATION">Negotiation</option>
                    <option value="CLOSED_WON">Closed Won</option>
                    <option value="CLOSED_LOST">Closed Lost</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Score</label>
                  <input
                    type="number"
                    value={editedLead.score || 0}
                    onChange={(e) => handleFieldChange('score', parseFloat(e.target.value))}
                    min="0"
                    max="100"
                    className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Budget</label>
                  <input
                    type="text"
                    value={editedLead.budget || ''}
                    onChange={(e) => handleFieldChange('budget', e.target.value)}
                    className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="e.g., $10,000 - $50,000"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Qualification Notes</label>
                  <input
                    type="text"
                    value={editedLead.qualificationNotes || ''}
                    onChange={(e) => handleFieldChange('qualificationNotes', e.target.value)}
                    className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Key qualification details"
                  />
                </div>
              </div>
            </div>

            {/* Notes */}
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Notes</h3>
              <textarea
                value={editedLead.notes || ''}
                onChange={(e) => handleFieldChange('notes', e.target.value)}
                rows={4}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Add notes about this lead..."
              />
            </div>

            {/* Metadata */}
            <div className="text-sm text-gray-500">
              <p>Created: {new Date(lead.createdAt).toLocaleString()}</p>
              <p>Last Updated: {new Date(lead.updatedAt).toLocaleString()}</p>
            </div>
          </div>
        )}

        {activeTab === 'activities' && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-gray-900">Activity History</h3>
            {lead.activities && lead.activities.length > 0 ? (
              <div className="space-y-3">
                {lead.activities.map((activity: any) => (
                  <div key={activity.id} className="border-l-4 border-blue-400 pl-4 py-2">
                    <div className="flex justify-between">
                      <p className="text-sm font-medium text-gray-900">{activity.type}</p>
                      <p className="text-xs text-gray-500">
                        {new Date(activity.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <p className="text-sm text-gray-600 mt-1">{activity.description}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-500 italic">No activities recorded yet</p>
            )}
          </div>
        )}

        {activeTab === 'messages' && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-gray-900">Message History</h3>
            {lead.messages && lead.messages.length > 0 ? (
              <div className="space-y-3">
                {lead.messages.map((message: any) => (
                  <div key={message.id} className="bg-gray-50 rounded-lg p-4">
                    <div className="flex justify-between mb-2">
                      <span className="text-sm font-medium text-gray-900">
                        {message.direction === 'OUTBOUND' ? 'Sent' : 'Received'}
                      </span>
                      <span className="text-xs text-gray-500">
                        {new Date(message.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-sm text-gray-700">{message.content}</p>
                    {message.status && (
                      <p className="text-xs text-gray-500 mt-2">Status: {message.status}</p>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-500 italic">No messages sent yet</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}