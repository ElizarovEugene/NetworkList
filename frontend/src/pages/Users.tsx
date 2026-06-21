import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getUsers, createUser, updateUser, deleteUser } from '../api'
import { Plus, Trash2, Pencil, Users as UsersIcon } from 'lucide-react'
import { useAuth } from '../auth/useAuth'
import { useI18n } from '../i18n/useI18n'
import type { User } from '../types'

const EMPTY_FORM = { username: '', password: '', language: 'en' }

export default function Users() {
  const { t } = useI18n()
  const { user: me } = useAuth()
  const qc = useQueryClient()
  const { data: users = [], isLoading } = useQuery({ queryKey: ['users'], queryFn: getUsers })
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editForm, setEditForm] = useState({ password: '', is_active: true, language: 'ru' })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['users'] })
  const createMut = useMutation({
    mutationFn: createUser,
    onSuccess: () => { invalidate(); setShowForm(false); setForm(EMPTY_FORM) },
  })
  const updateMut = useMutation({
    mutationFn: (vars: { id: number; data: Partial<{ password: string; is_active: boolean; language: string }> }) =>
      updateUser(vars.id, vars.data),
    onSuccess: () => { invalidate(); setEditingId(null) },
  })
  const deleteMut = useMutation({ mutationFn: deleteUser, onSuccess: invalidate })

  const startEdit = (u: User) => {
    setEditingId(u.id)
    setEditForm({ password: '', is_active: u.is_active, language: u.language })
  }

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault()
    createMut.mutate(form)
  }

  const handleUpdate = (id: number) => {
    const payload: Partial<{ password: string; is_active: boolean; language: string }> = {
      is_active: editForm.is_active,
      language: editForm.language,
    }
    if (editForm.password) payload.password = editForm.password
    updateMut.mutate({ id, data: payload })
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">{t('users.title')}</h1>
          <p className="text-gray-500 text-sm mt-1">{t('users.subtitle')}</p>
        </div>
        <button
          onClick={() => setShowForm(s => !s)}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white text-sm px-4 py-2 rounded-lg transition-colors"
        >
          <Plus size={16} /> {t('users.add')}
        </button>
      </div>

      {isLoading && <p className="text-gray-400 text-sm">{t('common.loading')}</p>}

      {showForm && (
        <form onSubmit={handleCreate} className="bg-white border border-gray-200 rounded-xl p-5 mb-6">
          <h2 className="text-gray-900 font-medium mb-4">{t('users.new')}</h2>
          <div className="grid grid-cols-3 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-gray-500 text-xs">{t('users.username')}</span>
              <input value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                className="bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900 text-sm focus:outline-none focus:border-blue-500" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-gray-500 text-xs">{t('users.password')}</span>
              <input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                className="bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900 text-sm focus:outline-none focus:border-blue-500" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-gray-500 text-xs">{t('users.language')}</span>
              <select value={form.language} onChange={e => setForm(f => ({ ...f, language: e.target.value }))}
                className="bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-700 text-sm focus:outline-none focus:border-blue-500">
                <option value="ru">{t('users.lang_ru')}</option>
                <option value="en">{t('users.lang_en')}</option>
              </select>
            </label>
          </div>
          {createMut.error && <p className="text-red-500 text-xs mt-2">{String(createMut.error)}</p>}
          <div className="flex gap-2 mt-4">
            <button type="submit" disabled={createMut.isPending}
              className="bg-blue-600 hover:bg-blue-500 text-white text-sm px-4 py-2 rounded-lg transition-colors disabled:opacity-50">
              {createMut.isPending ? t('common.saving') : t('users.create')}
            </button>
            <button type="button" onClick={() => setShowForm(false)}
              className="bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm px-4 py-2 rounded-lg transition-colors">
              {t('common.cancel')}
            </button>
          </div>
        </form>
      )}

      {!isLoading && users.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                {(['users.username', 'users.language', 'users.status'] as const).map(key => (
                  <th key={key} className="px-4 py-3 text-left text-gray-500 text-xs font-medium uppercase tracking-wider">{t(key)}</th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                  {editingId === u.id ? (
                    <>
                      <td className="px-4 py-3 text-gray-900 text-sm font-medium">{u.username}</td>
                      <td className="px-4 py-3">
                        <select value={editForm.language} onChange={e => setEditForm(f => ({ ...f, language: e.target.value }))}
                          className="bg-white border border-gray-300 rounded-lg px-2 py-1 text-gray-700 text-xs focus:outline-none focus:border-blue-500">
                          <option value="ru">{t('users.lang_ru')}</option>
                          <option value="en">{t('users.lang_en')}</option>
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        <select value={editForm.is_active ? '1' : '0'} onChange={e => setEditForm(f => ({ ...f, is_active: e.target.value === '1' }))}
                          className="bg-white border border-gray-300 rounded-lg px-2 py-1 text-gray-700 text-xs focus:outline-none focus:border-blue-500">
                          <option value="1">{t('users.active')}</option>
                          <option value="0">{t('users.inactive')}</option>
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <input type="password" placeholder={t('users.new_password')} value={editForm.password}
                            onChange={e => setEditForm(f => ({ ...f, password: e.target.value }))}
                            className="bg-white border border-gray-300 rounded-lg px-2 py-1 text-gray-900 text-xs w-32 placeholder-gray-300 focus:outline-none focus:border-blue-500" />
                          <button onClick={() => handleUpdate(u.id)} className="text-blue-600 hover:text-blue-700 text-xs font-medium">{t('common.save')}</button>
                          <button onClick={() => setEditingId(null)} className="text-gray-400 hover:text-gray-700 text-xs">{t('common.cancel')}</button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-4 py-3 text-gray-900 text-sm font-medium">
                        {u.username}
                        {u.id === me?.id && <span className="ml-1.5 text-gray-400 text-xs">({t('users.me')})</span>}
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-sm">{u.language === 'en' ? t('users.lang_en') : t('users.lang_ru')}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded border ${u.is_active ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-gray-100 text-gray-500 border-gray-200'}`}>
                          {u.is_active ? t('users.active') : t('users.inactive')}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <button onClick={() => startEdit(u)} className="text-gray-400 hover:text-blue-600 transition-colors" title={t('common.edit')}>
                            <Pencil size={14} />
                          </button>
                          {u.id !== me?.id && (
                            <button onClick={() => { if (confirm(t('users.delete_confirm'))) deleteMut.mutate(u.id) }}
                              className="text-gray-400 hover:text-red-500 transition-colors">
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!isLoading && users.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <UsersIcon size={40} className="mx-auto mb-3 opacity-30" />
        </div>
      )}
    </div>
  )
}
