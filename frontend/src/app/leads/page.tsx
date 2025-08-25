'use client';

import React, { useState, useEffect } from 'react';
import axios from 'axios';

interface Activity {
  id: string;
  type: string;
  description: string;
  createdAt: string;
}

interface Lead {
  id: string;
  companyName: string;
  contactName: string;
  email: string;
  score: number;
  stage: string;
  createdAt: string;
  activities?: Activity[];
  _count?: {
    activities: number;
    messages: number;
  };
}

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [expandedLeadId, setExpandedLeadId] = useState<string | null>(null);
  const [recalculating, setRecalculating] = useState(false);

  useEffect(() => {
    fetchLeads();
    
    // Refresh when page gains focus
    const handleFocus = () => {
      fetchLeads();
    };
    
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, []);

  const fetchLeads = async (showRefreshIndicator = false) => {
    if (showRefreshIndicator) {
      setIsRefreshing(true);
    }
    try {
      const response = await axios.get('/api/leads');
      setLeads(response.data);
      console.log('Fetched leads:', response.data); // Debug log
    } catch (error) {
      console.error('Error fetching leads:', error);
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  };
  
  const handleRefresh = () => {
    fetchLeads(true);
  };

  const recalculateAllScores = async () => {
    setRecalculating(true);
    try {
      const response = await axios.post('/api/leads/recalculate-all');
      console.log('Recalculation result:', response.data);
      // Refresh leads after recalculation
      await fetchLeads();
    } catch (error) {
      console.error('Error recalculating scores:', error);
    } finally {
      setRecalculating(false);
    }
  };

  const toggleLeadExpansion = (leadId: string) => {
    setExpandedLeadId(expandedLeadId === leadId ? null : leadId);
  };

  const getStageColor = (stage: string) => {
    const colors: any = {
      'NEW': 'bg-gray-100 text-gray-800',
      'QUALIFIED': 'bg-blue-100 text-blue-800',
      'CONTACTED': 'bg-yellow-100 text-yellow-800',
      'MEETING_SCHEDULED': 'bg-purple-100 text-purple-800',
      'PROPOSAL_SENT': 'bg-indigo-100 text-indigo-800',
      'NEGOTIATION': 'bg-orange-100 text-orange-800',
      'CLOSED_WON': 'bg-green-100 text-green-800',
      'CLOSED_LOST': 'bg-red-100 text-red-800'
    };
    return colors[stage] || 'bg-gray-100 text-gray-800';
  };

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-green-600 font-bold';
    if (score >= 60) return 'text-yellow-600 font-semibold';
    return 'text-gray-600';
  };

  const filteredLeads = leads.filter(lead => 
    lead.companyName.toLowerCase().includes(filter.toLowerCase()) ||
    lead.contactName.toLowerCase().includes(filter.toLowerCase())
  );

  if (loading) {
    return <div className="text-center py-8">Loading leads...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow-sm p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-bold text-gray-900">Lead Pipeline</h2>
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
          >
            {isRefreshing ? (
              <>
                <span className="animate-spin">⟳</span>
                Refreshing...
              </>
            ) : (
              <>
                🔄 Refresh
              </>
            )}
          </button>
        </div>
        
        <div className="mb-4">
          <input
            type="text"
            placeholder="Search leads..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {filteredLeads.length === 0 ? (
          <p className="text-gray-500 text-center py-8">No leads found</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Company
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Contact
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Score
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Stage
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredLeads.map((lead) => (
                  <React.Fragment key={lead.id}>
                    <tr className="hover:bg-gray-50 cursor-pointer" onClick={() => toggleLeadExpansion(lead.id)}>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <span className="mr-2 text-gray-400">
                            {expandedLeadId === lead.id ? '▼' : '▶'}
                          </span>
                          <div>
                            <div className="text-sm font-medium text-gray-900">
                              {lead.companyName}
                            </div>
                            <div className="text-sm text-gray-500">{lead.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {lead.contactName}
                        {lead._count && (
                          <div className="text-xs text-gray-500 mt-1">
                            {lead._count.activities} activities • {lead._count.messages} messages
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`text-sm ${getScoreColor(lead.score)}`}>
                          {Math.round(lead.score)}/100
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getStageColor(lead.stage)}`}>
                          {lead.stage.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        <a 
                          href={`/leads/${lead.id}`}
                          onClick={(e) => { e.stopPropagation(); }}
                          className="inline-flex items-center px-3 py-1 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
                        >
                          View
                        </a>
                      </td>
                    </tr>
                    {expandedLeadId === lead.id && lead.activities && (
                      <tr>
                        <td colSpan={5} className="px-6 py-4 bg-gray-50">
                          <div className="space-y-2">
                            <h4 className="font-semibold text-sm text-gray-700">Recent Activities:</h4>
                            {lead.activities.length === 0 ? (
                              <p className="text-sm text-gray-500 italic">No activities yet</p>
                            ) : (
                              <div className="space-y-1">
                                {lead.activities.map((activity) => (
                                  <div key={activity.id} className="flex items-center text-sm text-gray-600">
                                    <span className="mr-2">•</span>
                                    <span className="font-medium mr-2">{activity.type.replace(/_/g, ' ')}:</span>
                                    <span>{activity.description}</span>
                                    <span className="ml-auto text-xs text-gray-400">
                                      {new Date(activity.createdAt).toLocaleDateString()}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pipeline Summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <SummaryCard
          title="Total Leads"
          value={leads.length}
          icon="📊"
        />
        <SummaryCard
          title="Qualified"
          value={leads.filter(l => l.stage === 'QUALIFIED').length}
          icon="✅"
        />
        <SummaryCard
          title="In Meeting"
          value={leads.filter(l => l.stage === 'MEETING_SCHEDULED').length}
          icon="📅"
        />
        <SummaryCard
          title="High Score (80+)"
          value={leads.filter(l => l.score >= 80).length}
          icon="🔥"
        />
      </div>
    </div>
  );
}

function SummaryCard({ title, value, icon }: any) {
  return (
    <div className="bg-white rounded-lg shadow-sm p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-600">{title}</p>
          <p className="text-2xl font-bold text-gray-900">{value}</p>
        </div>
        <div className="text-3xl">{icon}</div>
      </div>
    </div>
  );
}