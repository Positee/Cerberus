import { useEffect, useState } from 'react';
import { Check, Info, TriangleAlert } from 'lucide-react';
import { ApiFailure, getPlan, type PlanPayload } from '../app/api';
import type { Session } from '../app/session';
import {
  describeLimit,
  LIMITS,
  LIMIT_LABEL,
  PLAN_BLURB,
  PLAN_CHANGE_NOTE,
  PLAN_FEATURES,
  PLAN_LABEL,
  PLAN_ORDER,
  PRICE,
  planRank,
  yearlySaving,
  type BillingPeriod,
  type LimitKey,
  type Plan,
} from '../../shared/plans';

/**
 * Usage and plan.
 *
 * What this workspace holds, against what its plan allows, then the plans
 * themselves. The meters come first, because somebody opening this page is
 * usually asking whether they are about to run out of something.
 */

/** Caps worth metering. History is a span, so it is reported, never filled. */
const METERED: LimitKey[] = ['seats', 'alertRules', 'contactPoints', 'monitors', 'schedules', 'projects'];

function Meter({ used, cap }: { used: number; cap: number | null }) {
  if (cap === null) {
    return (
      <div className="meter unlimited">
        <span className="meter-fill" style={{ width: '100%' }} />
      </div>
    );
  }

  const share = cap === 0 ? 1 : Math.min(1, used / cap);
  const full = used >= cap;
  const close = !full && share >= 0.8;

  return (
    <div className={`meter${full ? ' full' : close ? ' close' : ''}`}>
      <span className="meter-fill" style={{ width: `${Math.round(share * 100)}%` }} />
    </div>
  );
}

export default function Usage({ session }: { session: Session }) {
  const [data, setData] = useState<PlanPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<BillingPeriod>(session.organization.billingPeriod);

  useEffect(() => {
    let alive = true;

    getPlan()
      .then((result) => {
        if (alive) setData(result);
      })
      .catch((caught) => {
        if (alive) setError(caught instanceof ApiFailure ? caught.message : 'Cerberus cannot load your plan.');
      });

    return () => {
      alive = false;
    };
  }, []);

  const plan = data?.subscription.plan ?? session.organization.plan;
  const limits = LIMITS[plan];

  return (
    <div className="page usage-page">
      {error && (
        <p className="auth-error" role="alert">
          <TriangleAlert size={15} aria-hidden="true" />
          {error}
        </p>
      )}

      <section className="panel">
        <div className="panel-head">
          <h3>Your plan</h3>
          <p>
            {session.organization.name} is on <strong>{PLAN_LABEL[plan]}</strong>
            {data ? `, billed ${data.subscription.period === 'yearly' ? 'yearly' : 'monthly'}.` : '.'}
          </p>
        </div>

        <p className="policy-note">
          <Info size={15} aria-hidden="true" />
          {PLAN_CHANGE_NOTE}
        </p>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h3>What you are using</h3>
          <p>Counted against what {PLAN_LABEL[plan]} allows.</p>
        </div>

        {data === null && !error ? (
          <>
            <span className="skeleton skeleton-line" />
            <span className="skeleton skeleton-line" />
          </>
        ) : data === null ? null : (
          <ul className="usage-list">
            {METERED.map((key) => {
              const cap = limits[key];
              const used = data.usage[key];
              return (
                <li key={key}>
                  <span className="usage-head">
                    <strong>{LIMIT_LABEL[key]}</strong>
                    <span className="usage-count">
                      {used} of {cap === null ? 'unlimited' : cap}
                    </span>
                  </span>
                  <Meter used={used} cap={cap} />
                </li>
              );
            })}
            <li>
              <span className="usage-head">
                <strong>{LIMIT_LABEL.historyDays}</strong>
                <span className="usage-count">{describeLimit('historyDays', plan)}</span>
              </span>
            </li>
          </ul>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h3>Plans</h3>
          <p>Every plan holds everything the one before it holds.</p>
        </div>

        <div className="period-switch" role="radiogroup" aria-label="Billing period">
          {(['monthly', 'yearly'] as BillingPeriod[]).map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={period === option}
              className={period === option ? 'period-option on' : 'period-option'}
              onClick={() => setPeriod(option)}
            >
              {option === 'monthly' ? 'Monthly' : 'Yearly'}
              {option === 'yearly' && <span className="period-save">Save {yearlySaving('pro')}%</span>}
            </button>
          ))}
        </div>

        <div className="plan-cards">
          {PLAN_ORDER.map((tier) => {
            const price = PRICE[tier];
            const amount = period === 'yearly' ? price.yearly : price.monthly;
            const current = tier === plan;
            const below = planRank(tier) < planRank(plan);

            return (
              <article className={`plan-card${current ? ' current' : ''}`} key={tier}>
                <header>
                  <h4>{PLAN_LABEL[tier]}</h4>
                  <p>{PLAN_BLURB[tier]}</p>
                </header>

                <p className="plan-price">
                  {amount === null ? (
                    <span className="plan-quote">Contact us</span>
                  ) : (
                    <>
                      <strong>${amount}</strong>
                      <span>{amount === 0 ? 'always' : period === 'yearly' ? 'per year' : 'per month'}</span>
                    </>
                  )}
                </p>

                <ul className="plan-features">
                  {PLAN_FEATURES[tier].map((line) => (
                    <li key={line}>
                      <Check size={13} aria-hidden="true" />
                      {line}
                    </li>
                  ))}
                </ul>

                <div className="plan-action">
                  {current ? (
                    <span className="plan-current">Your plan</span>
                  ) : below ? (
                    <span className="plan-current muted">Included</span>
                  ) : (
                    <button type="button" className="primary-button" disabled title={PLAN_CHANGE_NOTE}>
                      {tier === 'enterprise' ? 'Talk to us' : `Move to ${PLAN_LABEL[tier]}`}
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
