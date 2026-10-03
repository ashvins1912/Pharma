import React, { useState } from 'react';
import apiClient from '../api/apiClient';

export default function OrderRatingPrompt({ order, onClose, onSubmitted }) {
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  if (!order) return null;

  const submitRating = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      await apiClient.post(`/api/orders/${encodeURIComponent(order._id)}/rating`, {
        rating,
        comment
      });
      onSubmitted();
    } catch (requestError) {
      setError(requestError.message || 'Unable to submit your feedback right now. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center overflow-y-auto bg-slate-900/60 p-4 backdrop-blur-sm">
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="delivery-rating-title"
        onSubmit={submitRating}
        className="w-full max-w-md space-y-5 rounded-3xl bg-white p-6 shadow-2xl"
      >
        <div>
          <p className="text-xs font-black uppercase tracking-wider text-emerald-700">Delivery complete</p>
          <h2 id="delivery-rating-title" className="mt-1 text-lg font-black text-slate-900">
            How was your delivery?
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Order #{String(order._id).slice(-6).toUpperCase()}
          </p>
        </div>

        <fieldset>
          <legend className="mb-2 text-xs font-bold text-slate-700">Your rating</legend>
          <div className="flex gap-2" role="radiogroup" aria-label="Delivery rating">
            {[1, 2, 3, 4, 5].map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={rating === value}
                aria-label={`${value} star${value === 1 ? '' : 's'}`}
                onClick={() => setRating(value)}
                className={`text-3xl ${value <= rating ? 'text-amber-400' : 'text-slate-300'}`}
              >
                ★
              </button>
            ))}
          </div>
        </fieldset>

        <label className="block text-xs font-bold text-slate-700">
          Comments (optional)
          <textarea
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            maxLength={1000}
            rows={3}
            className="mt-2 w-full resize-y rounded-xl border border-slate-200 p-3 text-sm font-normal outline-none focus:border-blue-500"
          />
        </label>

        {error && <p role="alert" className="text-xs font-semibold text-rose-700">{error}</p>}

        <div className="flex gap-2">
          <button
            type="button"
            disabled={submitting}
            onClick={onClose}
            className="w-1/2 rounded-xl bg-slate-100 py-2.5 text-xs font-bold text-slate-700 disabled:opacity-50"
          >
            Later
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="w-1/2 rounded-xl bg-blue-600 py-2.5 text-xs font-extrabold text-white disabled:opacity-50"
          >
            {submitting ? 'Sending...' : 'Submit rating'}
          </button>
        </div>
      </form>
    </div>
  );
}
