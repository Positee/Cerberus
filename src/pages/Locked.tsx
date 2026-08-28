import { Link } from 'react-router-dom';
import { Check, Lock } from 'lucide-react';
import {
  PLAN_FEATURES,
  PLAN_LABEL,
  PRICE,
  type Plan,
} from '../../shared/plans';

/**
 * What a module looks like when the plan does not reach it.
 *
 * It says what the module does before it says what it costs. Somebody who
 * cannot picture the feature has no reason to pay for it.
 */

export default function Locked({
  label,
  subtitle,
  needed,
}: {
  label: string;
  subtitle: string;
  needed: Plan;
}) {
  const price = PRICE[needed];

  return (
    <div className="page locked-page">
      <section className="locked-card">
        <span className="locked-mark" aria-hidden="true">
          <Lock size={20} />
        </span>

        <h2>{label} is on {PLAN_LABEL[needed]}</h2>
        <p className="locked-blurb">{subtitle}</p>

        <ul className="locked-list">
          {PLAN_FEATURES[needed].map((line) => (
            <li key={line}>
              <Check size={14} aria-hidden="true" />
              {line}
            </li>
          ))}
        </ul>

        <div className="locked-foot">
          {price.monthly === null ? (
            <p className="locked-price">Priced by the size of your team.</p>
          ) : (
            <p className="locked-price">
              <strong>${price.monthly}</strong> <span>per month</span>
            </p>
          )}
          <Link className="primary-button" to="/usage">
            See the plans
          </Link>
        </div>
      </section>
    </div>
  );
}
